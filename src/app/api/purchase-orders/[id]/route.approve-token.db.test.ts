import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// "Approve and send to the Vendor" only goes through for what the approver was looking at (review token).
// Production schema + v30-v35, PGlite.

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  recordPurchaseOrderCommunication: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/po-communication", () => ({ recordPurchaseOrderCommunication: mocks.recordPurchaseOrderCommunication }));

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder } from "@/test/purchase-order-dept-fixtures";
import { GET, PATCH } from "./route";

const sql = dbSql as unknown as PgliteSql;
const labA = { username: "managera", name: "Manager A", role: "Manager", scope: DEPT_A };
const labB = { username: "managerb", name: "Manager B", role: "Manager", scope: DEPT_B };
const adminAll = { username: "admin1", name: "Admin", role: "Admin", scope: "ALL" };
const vendorA = { username: "vendor1", name: "Vendor", role: "Vendor", vendor: "Vendor A" };

let poId: number;

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
}, 120_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(labA);
  await sql.db.exec(`TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders, inventory RESTART IDENTITY CASCADE;`);
  poId = (await insertPurchaseOrder(sql, { poNumber: "PO-PENDING", departmentId: DEPT_A, status: "PENDING_MANAGER_REVIEW", itemId: "A-000002", quantity: 10, vendor: "Vendor A" })).poId;
});

afterEach(() => {
  resetDepartmentsFlagForTests();
});

const get = (id: number = poId) => GET(new Request(`http://localhost/api/purchase-orders/${id}`), { params: Promise.resolve({ id: String(id) }) });
const patch = (body: unknown, id: number = poId) =>
  PATCH(new Request(`http://localhost/api/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) });
const tokenNow = async () => ((await (await get()).json()) as { review_token?: string }).review_token;
const approve = async (token?: unknown) => patch({ action: "APPROVE_MANAGER_REVIEW", review_token: token });
const rows = async <T = Record<string, unknown>>(query: string) => (await sql.db.query<T>(query)).rows;
const statusOf = async () => (await rows<{ status: string }>(`SELECT status FROM purchase_orders WHERE id = ${poId}`))[0].status;

describe("the review token", () => {
  it("is given to the Lab with an order in review, and to nobody else or in any other status", async () => {
    expect(await tokenNow()).toMatch(/^[0-9a-f]{32}$/);
    mocks.getAuthenticatedUser.mockResolvedValue(vendorA);
    expect((await get()).status).toBe(403);
    mocks.getAuthenticatedUser.mockResolvedValue(labA);
    await sql.db.exec(`UPDATE purchase_orders SET status = 'SUBMITTED' WHERE id = ${poId}`);
    expect(await tokenNow()).toBeUndefined();
    mocks.getAuthenticatedUser.mockResolvedValue(vendorA);
    expect(((await (await get()).json()) as Record<string, unknown>).review_token).toBeUndefined();
  });

  it("stays the same while nothing changes and changes with a line, a quantity, the note or the date", async () => {
    const first = await tokenNow();
    expect(await tokenNow()).toBe(first);
    const seen = new Set([first]);
    for (const change of [
      `INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit) VALUES (${poId}, 'LAB-000001', 'Reagent 1', 2, 'box')`,
      `UPDATE purchase_order_items SET quantity = 11 WHERE po_id = ${poId} AND item_id = 'A-000002'`,
      `UPDATE purchase_orders SET note = 'changed' WHERE id = ${poId}`,
      `UPDATE purchase_orders SET expected_date = '2026-12-01' WHERE id = ${poId}`,
    ]) {
      await sql.db.exec(change);
      const next = await tokenNow();
      expect(seen.has(next), change).toBe(false);
      seen.add(next);
    }
  });
});

describe("approving an order in review", () => {
  it("goes through with the token the approver was shown: SUBMITTED, reviewer, response due date, Vendor told", async () => {
    const response = await approve(await tokenNow());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "SUBMITTED", reviewed_by: "managera" });
    const [po] = await rows<{ status: string; vendor_response_due_at: string | null; reviewed_by: string }>(`SELECT status, vendor_response_due_at, reviewed_by FROM purchase_orders WHERE id = ${poId}`);
    expect(po).toMatchObject({ status: "SUBMITTED", reviewed_by: "managera" });
    expect(po.vendor_response_due_at).not.toBeNull();
    expect(mocks.recordPurchaseOrderCommunication).toHaveBeenCalledWith(expect.objectContaining({ poId, eventType: "PO_CREATED" }));
  });

  it("is refused with 409 PO_REVIEW_CHANGED and writes nothing without a token or with a wrong one", async () => {
    for (const token of [undefined, null, "", "not-a-token", 123, "0".repeat(32), "A".repeat(32)]) {
      const response = await approve(token);
      expect(response.status, String(token)).toBe(409);
      expect(await response.json()).toMatchObject({ code: "PO_REVIEW_CHANGED" });
    }
    expect(await statusOf()).toBe("PENDING_MANAGER_REVIEW");
    expect(mocks.recordPurchaseOrderCommunication).not.toHaveBeenCalled();
  });

  it.each([
    ["a line was added", (id: number) => `INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit) VALUES (${id}, 'LAB-000001', 'Reagent 1', 2, 'box')`],
    ["a quantity was changed", (id: number) => `UPDATE purchase_order_items SET quantity = 99 WHERE po_id = ${id}`],
    ["the note was changed", (id: number) => `UPDATE purchase_orders SET note = 'someone else edited' WHERE id = ${id}`],
    ["the expected date was changed", (id: number) => `UPDATE purchase_orders SET expected_date = '2026-12-24' WHERE id = ${id}`],
  ])("is refused when %s after the approver opened the order, and goes through after they look again", async (_label, change) => {
    const opened = await tokenNow(); // what the approver saw
    await sql.db.exec(change(poId)); // another manager changes the order
    const refused = await approve(opened);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "PO_REVIEW_CHANGED", error: expect.stringContaining("รีเฟรช") });
    expect(await statusOf()).toBe("PENDING_MANAGER_REVIEW");
    expect(mocks.recordPurchaseOrderCommunication).not.toHaveBeenCalled();

    expect((await approve(await tokenNow())).status).toBe(200); // after refreshing the page
    expect(await statusOf()).toBe("SUBMITTED");
  });

  it("answers 409 and records nothing when someone rejected it first", async () => {
    const opened = await tokenNow();
    expect((await patch({ action: "REJECT_MANAGER_REVIEW", vendor_note: "no" })).status).toBe(200);
    mocks.recordPurchaseOrderCommunication.mockClear();
    const late = await approve(opened);
    expect(late.status).toBe(409);
    expect(await statusOf()).toBe("REJECTED");
    expect(mocks.recordPurchaseOrderCommunication).not.toHaveBeenCalled();
  });

  it("the approval itself writes nothing when the status moved on between reading the order and the transaction (even with a valid token)", async () => {
    const { approveManagerReview } = await import("@/lib/purchase-order-review-token");
    const token = await tokenNow();
    await sql.db.exec(`UPDATE purchase_orders SET status = 'SUBMITTED', reviewed_by = 'someone-else' WHERE id = ${poId}`);
    const result = await approveManagerReview(sql as never, { po: { id: poId }, reviewer: "managera", expectedToken: token, scope: { mode: "one", departmentId: DEPT_A } });
    expect(result).toMatchObject({ ok: false, code: "PO_STATE_CHANGED" });
    expect(await rows(`SELECT status, reviewed_by FROM purchase_orders WHERE id = ${poId}`)).toEqual([{ status: "SUBMITTED", reviewed_by: "someone-else" }]);
  });

  it("rejecting does not need a token", async () => {
    const response = await patch({ action: "REJECT_MANAGER_REVIEW", vendor_note: "ไม่อนุมัติ" });
    expect(response.status).toBe(200);
    expect(await statusOf()).toBe("REJECTED");
    expect(await rows(`SELECT vendor_note FROM purchase_orders WHERE id = ${poId}`)).toEqual([{ vendor_note: "ไม่อนุมัติ" }]);
  });

  it("keeps the room rules: other room 404, Admin viewing all rooms DEPARTMENT_READ_ONLY, Vendor and plain users refused, nothing changes", async () => {
    const token = await tokenNow();
    mocks.getAuthenticatedUser.mockResolvedValue(labB);
    expect((await approve(token)).status).toBe(404);
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    const readOnly = await approve(token);
    expect(readOnly.status).toBe(409);
    expect(await readOnly.json()).toMatchObject({ code: "DEPARTMENT_READ_ONLY" });
    mocks.getAuthenticatedUser.mockResolvedValue(vendorA);
    expect((await approve(token)).status).toBe(409); // the Vendor branch of the route does not know this action; the order is untouched
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "u", name: "U", role: "User", scope: DEPT_A });
    expect((await approve(token)).status).toBe(403);
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    expect((await approve(token)).status).toBe(401);
    expect(await statusOf()).toBe("PENDING_MANAGER_REVIEW");
  });
});
