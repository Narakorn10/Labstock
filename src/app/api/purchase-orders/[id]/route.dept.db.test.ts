import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of GET/PATCH /api/purchase-orders/[id] on the production schema + v30-v35 (PGlite).

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
});

afterEach(() => {
  resetDepartmentsFlagForTests();
});

const get = (id: string | number) =>
  GET(new Request(`http://localhost/api/purchase-orders/${id}`), { params: Promise.resolve({ id: String(id) }) });
const patch = (id: string | number, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/purchase-orders/${id}`, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id: String(id) }) },
  );

async function snapshot(poId: number) {
  const po = (await sql.db.query(`SELECT * FROM purchase_orders WHERE id = ${poId}`)).rows;
  const items = (await sql.db.query(`SELECT * FROM purchase_order_items WHERE po_id = ${poId} ORDER BY id`)).rows;
  return JSON.stringify({ po, items });
}

// Every Lab write action of the route, each with the PO status it needs.
type Case = { name: string; status: string; acceptedQty?: number; body: (itemRowId: number) => Record<string, unknown> };
const LAB_ACTIONS: Case[] = [
  { name: "CONFIRM_LAB_RECEIPT", status: "CONFIRMED", body: (item) => ({ action: "CONFIRM_LAB_RECEIPT", item_ids: [item] }) },
  { name: "CANCEL", status: "SUBMITTED", body: () => ({ action: "CANCEL", vendor_note: "not needed" }) },
  { name: "CLOSE_SHORT", status: "PARTIALLY_RECEIVED", acceptedQty: 3, body: () => ({ action: "CLOSE_SHORT", vendor_note: "vendor discontinued" }) },
  {
    name: "UPDATE_UNACKNOWLEDGED_LAB_ORDER", status: "SUBMITTED",
    body: () => ({ action: "UPDATE_UNACKNOWLEDGED_LAB_ORDER", note: "edited", items: [{ item_id: "MB-000001", item_name: "Dept B item 1", quantity: 9, unit: "box", override_reason: "fewer" }] }),
  },
  { name: "APPROVE_MANAGER_REVIEW", status: "PENDING_MANAGER_REVIEW", body: () => ({ action: "APPROVE_MANAGER_REVIEW" }) },
  { name: "REJECT_MANAGER_REVIEW", status: "PENDING_MANAGER_REVIEW", body: () => ({ action: "REJECT_MANAGER_REVIEW", vendor_note: "no" }) },
  { name: "Lab review CONFIRMED", status: "PENDING_LAB_REVIEW", body: () => ({ status: "CONFIRMED" }) },
  { name: "Lab review REJECTED", status: "PENDING_LAB_REVIEW", body: () => ({ status: "REJECTED" }) },
  { name: "APPROVE_REVISION", status: "REVISION_REQUESTED", body: () => ({ action: "APPROVE_REVISION" }) },
  { name: "REJECT_REVISION", status: "REVISION_REQUESTED", body: () => ({ action: "REJECT_REVISION" }) },
];

async function seedFor(testCase: Case, departmentId: number, poNumber = "PO-X") {
  const itemId = departmentId === DEPT_B ? "MB-000001" : "A-000002";
  return insertPurchaseOrder(sql, { poNumber, departmentId, status: testCase.status, itemId, quantity: 10, acceptedQty: testCase.acceptedQty ?? 0, vendor: departmentId === DEPT_B ? "MB Vendor" : "Vendor A" });
}

describe("GET /api/purchase-orders/[id]", () => {
  beforeEach(async () => {
    await insertPurchaseOrder(sql, { poNumber: "PO-A", departmentId: DEPT_A, status: "SUBMITTED", itemId: "A-000002" });
    await insertPurchaseOrder(sql, { poNumber: "PO-B", departmentId: DEPT_B, status: "SUBMITTED", itemId: "MB-000001", vendor: "MB Vendor" });
  });

  it("returns a purchase order of the user's own department (by id and by po_number)", async () => {
    expect((await get(1)).status).toBe(200);
    const byNumber = await get("PO-A");
    expect(byNumber.status).toBe(200);
    expect(await byNumber.json()).toMatchObject({ po_number: "PO-A" });
  });

  it("answers 404 for a purchase order of another department, by id and by po_number", async () => {
    expect((await get(2)).status).toBe(404);
    expect((await get("PO-B")).status).toBe(404);
    mocks.getAuthenticatedUser.mockResolvedValue(labB);
    expect((await get(1)).status).toBe(404);
    expect((await get("PO-A")).status).toBe(404);
  });

  it("an Admin viewing all departments can read either one", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    expect((await get(2)).status).toBe(200);
    expect((await get("PO-B")).status).toBe(200);
  });

  it("current_stock_qty ignores stock of the same item held by another department", async () => {
    await sql.db.exec(`
      INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
        ('A-000002', 'LA1', CURRENT_DATE + 100, 3, '2026-09-01', ${DEPT_A}),
        ('A-000002', 'LB1', CURRENT_DATE + 100, 4, '2026-09-01', ${DEPT_B});
    `);
    const own = await (await get(1)).json() as { items: Array<{ current_stock_qty: string }> };
    expect(Number(own.items[0].current_stock_qty)).toBe(3);
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    const everything = await (await get(1)).json() as { items: Array<{ current_stock_qty: string }> };
    expect(Number(everything.items[0].current_stock_qty)).toBe(7);
  });

  it("a user who asked for a department they are not in gets DEPARTMENT_NOT_FOUND (404), not 500", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...labA, departmentDenied: true });
    const response = await get(1);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "DEPARTMENT_NOT_FOUND" });
  });

  it("a Vendor reads an order of its own company in any department (temporarily accepted, question #3 still open)", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "vendor2", name: "Vendor Two", role: "Vendor", vendor: "MB Vendor", scope: DEPT_A });
    const response = await get(2); // PO-B belongs to department B, the Vendor's resolved scope is A
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ po_number: "PO-B" });
  });
});

describe.each(LAB_ACTIONS)("PATCH /api/purchase-orders/[id] $name", (testCase) => {
  it("works on a purchase order of the user's own department (control)", async () => {
    const { poId, itemRowId } = await seedFor(testCase, DEPT_B);
    mocks.getAuthenticatedUser.mockResolvedValue(labB);
    const before = await snapshot(poId);
    const response = await patch(poId, testCase.body(itemRowId));
    expect(response.status).toBe(200);
    expect(await snapshot(poId)).not.toBe(before);
  });

  it("answers 404 for a purchase order of another department and changes nothing", async () => {
    const { poId, itemRowId } = await seedFor(testCase, DEPT_B);
    const before = await snapshot(poId);
    const response = await patch(poId, testCase.body(itemRowId)); // user is in department A
    expect(response.status).toBe(404);
    expect(await snapshot(poId)).toBe(before);
    expect(mocks.recordPurchaseOrderCommunication).not.toHaveBeenCalled();
  });

  it("answers 409 DEPARTMENT_READ_ONLY for an Admin viewing all departments and changes nothing", async () => {
    const { poId, itemRowId } = await seedFor(testCase, DEPT_B);
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    const before = await snapshot(poId);
    const response = await patch(poId, testCase.body(itemRowId));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DEPARTMENT_READ_ONLY" });
    expect(await snapshot(poId)).toBe(before);
  });
});

describe("PATCH /api/purchase-orders/[id] scope handling", () => {
  it("mode all is rejected before the request body is read", async () => {
    const { poId } = await seedFor(LAB_ACTIONS[1], DEPT_B);
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    const response = await patch(poId, "this is not json");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DEPARTMENT_READ_ONLY" });
  });

  it("a user who asked for a department they are not in gets DEPARTMENT_NOT_FOUND (404), not 500", async () => {
    const { poId, itemRowId } = await seedFor(LAB_ACTIONS[0], DEPT_A);
    mocks.getAuthenticatedUser.mockResolvedValue({ ...labA, departmentDenied: true });
    const before = await snapshot(poId);
    const response = await patch(poId, LAB_ACTIONS[0].body(itemRowId));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "DEPARTMENT_NOT_FOUND" });
    expect(await snapshot(poId)).toBe(before);
  });

  it("Vendor actions are unchanged: a Vendor acknowledges an order of its company in any department", async () => {
    const { poId } = await insertPurchaseOrder(sql, { poNumber: "PO-V", departmentId: DEPT_B, status: "SUBMITTED", itemId: "MB-000001", vendor: "MB Vendor" });
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "vendor2", name: "Vendor Two", role: "Vendor", vendor: "MB Vendor", scope: DEPT_A });
    const response = await patch(poId, { action: "ACKNOWLEDGE" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ACKNOWLEDGED" });
  });

  it("a Vendor still cannot touch another company's order", async () => {
    const { poId } = await insertPurchaseOrder(sql, { poNumber: "PO-V", departmentId: DEPT_B, status: "SUBMITTED", itemId: "MB-000001", vendor: "MB Vendor" });
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "vendor1", name: "Vendor One", role: "Vendor", vendor: "Vendor A", scope: DEPT_B });
    expect((await patch(poId, { action: "ACKNOWLEDGE" })).status).toBe(403);
  });
});
