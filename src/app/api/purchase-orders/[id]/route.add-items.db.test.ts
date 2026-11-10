import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// ADD_ITEMS_TO_MANAGER_REVIEW: a manager adds reagent lines to an order still waiting for their review
// (production schema + v30-v35, PGlite). Add only; only while PENDING_MANAGER_REVIEW; checked like order creation.

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  recordPurchaseOrderCommunication: vi.fn(),
  // Runs right after the suggestions were computed and before the transaction: lets a test change the world in between.
  afterSuggestions: null as null | (() => Promise<void>),
}));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/po-communication", () => ({ recordPurchaseOrderCommunication: mocks.recordPurchaseOrderCommunication }));
vi.mock("@/lib/purchase-order-suggestions", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/purchase-order-suggestions")>();
  return {
    ...actual,
    getPurchaseOrderSuggestions: async (...args: Parameters<typeof actual.getPurchaseOrderSuggestions>) => {
      const result = await actual.getPurchaseOrderSuggestions(...args);
      await mocks.afterSuggestions?.();
      return result;
    },
  };
});

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder } from "@/test/purchase-order-dept-fixtures";
import { PATCH } from "./route";

const sql = dbSql as unknown as PgliteSql;
const labA = { username: "managera", name: "Manager A", role: "Manager", scope: DEPT_A };
const labB = { username: "managerb", name: "Manager B", role: "Manager", scope: DEPT_B };
const adminA = { username: "admina", name: "Admin A", role: "Admin", scope: DEPT_A };
const adminAll = { username: "admin1", name: "Admin", role: "Admin", scope: "ALL" };
const legacyManager = { username: "manager1", name: "Manager", role: "Manager" };
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
  mocks.afterSuggestions = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(labA);
  await sql.db.exec(`
    TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders, inventory RESTART IDENTITY CASCADE;
    UPDATE master_data SET is_active = TRUE;
  `);
  // dept A, Vendor A, pending the manager's review, one line (A-000002)
  poId = (await insertPurchaseOrder(sql, { poNumber: "PO-PENDING", departmentId: DEPT_A, status: "PENDING_MANAGER_REVIEW", itemId: "A-000002", quantity: 10, vendor: "Vendor A" })).poId;
});

afterEach(() => {
  resetDepartmentsFlagForTests();
  mocks.afterSuggestions = null;
});

const add = (items: unknown, id: number = poId, extra: Record<string, unknown> = {}) =>
  PATCH(
    new Request(`http://localhost/api/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify({ action: "ADD_ITEMS_TO_MANAGER_REVIEW", items, ...extra }) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
// reason: a text, or null for "no reason sent" (a default value would silently turn undefined into a reason)
const line = (itemId: string, quantity = 3, reason: string | null = "ขาดช่วงใช้งาน") => ({
  item_id: itemId, item_name: "x", quantity, unit: "x", ...(reason === null ? {} : { override_reason: reason }),
});
const rows = async <T = Record<string, unknown>>(query: string) => (await sql.db.query<T>(query)).rows;
const itemIds = async () => (await rows<{ item_id: string }>(`SELECT item_id FROM purchase_order_items WHERE po_id = ${poId} ORDER BY id`)).map((row) => row.item_id);
async function snapshot() {
  return JSON.stringify({
    po: await rows(`SELECT * FROM purchase_orders WHERE id = ${poId}`),
    items: await rows(`SELECT * FROM purchase_order_items WHERE po_id = ${poId} ORDER BY id`),
  });
}

describe("adding lines to an order waiting for manager review", () => {
  it("adds the line, keeps the existing line and the status, and records who added what for the Lab only", async () => {
    const before = await rows<{ id: number; quantity: string }>(`SELECT id, quantity FROM purchase_order_items WHERE po_id = ${poId}`);
    const response = await add([line("LAB-000001", 3, "ขาดช่วงใช้งาน")], poId, { note: "เพิ่มตามที่หัวหน้าสั่ง" });
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string; items: Array<{ item_id: string }> };
    expect(body.status).toBe("PENDING_MANAGER_REVIEW");
    expect(body.items.map((item) => item.item_id)).toEqual(["A-000002", "LAB-000001"]);
    expect(await rows(`SELECT id, quantity FROM purchase_order_items WHERE po_id = ${poId} AND item_id = 'A-000002'`)).toEqual(before);

    expect(mocks.recordPurchaseOrderCommunication).toHaveBeenCalledTimes(1);
    expect(mocks.recordPurchaseOrderCommunication).toHaveBeenCalledWith(expect.objectContaining({
      poId,
      eventType: "PO_ITEMS_ADDED",
      actor: expect.objectContaining({ username: "managera" }),
      metadata: expect.objectContaining({
        fromStatus: "PENDING_MANAGER_REVIEW",
        items: [expect.objectContaining({ item_id: "LAB-000001", quantity: 3, reason: "ขาดช่วงใช้งาน" })],
      }),
    }));
  });

  it("takes name and unit from the system, copies the reagent classification, and stores the audit snapshot", async () => {
    expect((await add([{ item_id: "LAB-000001", item_name: "HACKED NAME", quantity: 2, unit: "HACKED UNIT", override_reason: "เหตุผล" }])).status).toBe(200);
    const [added] = await rows<Record<string, unknown>>(`SELECT * FROM purchase_order_items WHERE po_id = ${poId} AND item_id = 'LAB-000001'`);
    expect(added).toMatchObject({ item_name: "Reagent 1", unit: "box", reagent_type: "Chemistry", job_type: "Routine", machine_type: "AU5800", selected_basis: "MANUAL", override_reason: "เหตุผล" });
    expect(Number(added.quantity)).toBe(2);
    expect(added.calculation_version).toBeTruthy();
    expect(added.calculation_snapshot).toBeTruthy();
  });

  it("works for an Admin of the room and for the legacy (departments off) path", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminA);
    expect((await add([line("LAB-000001")])).status).toBe(200);
    await sql.db.exec(`DELETE FROM purchase_order_items WHERE po_id = ${poId} AND item_id = 'LAB-000001'`);
    mocks.getAuthenticatedUser.mockResolvedValue(legacyManager);
    expect((await add([line("LAB-000001")])).status).toBe(200);
    expect(await itemIds()).toEqual(["A-000002", "LAB-000001"]);
  });

  it("only while the order waits for review: SUBMITTED (the Vendor can see it) is refused and nothing changes", async () => {
    await sql.db.exec(`UPDATE purchase_orders SET status = 'SUBMITTED' WHERE id = ${poId}`);
    const before = await snapshot();
    const response = await add([line("LAB-000001")]);
    expect(response.status).toBe(409);
    expect(await snapshot()).toBe(before);
    expect(mocks.recordPurchaseOrderCommunication).not.toHaveBeenCalled();
  });

  it("refuses an order that is not a Lab order", async () => {
    await sql.db.exec(`UPDATE purchase_orders SET proposal_origin = 'VENDOR' WHERE id = ${poId}`);
    const before = await snapshot();
    expect((await add([line("LAB-000001")])).status).toBe(409);
    expect(await snapshot()).toBe(before);
  });

  it("refuses a reagent of another company, of another room, an inactive one and one that is already on the order", async () => {
    const before = await snapshot();
    expect((await add([line("LAB-000002")])).status).toBe(400); // Vendor B
    expect((await add([line("MB-000001")])).status).toBe(400); // other room, other company
    await sql.db.exec(`UPDATE master_data SET is_active = FALSE WHERE item_id = 'LAB-000001'`);
    expect((await add([line("LAB-000001")])).status).toBe(400); // inactive
    const duplicate = await add([line("A-000002")]);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: expect.stringContaining("มีอยู่ในใบสั่งซื้อนี้แล้ว") });
    expect(await snapshot()).toBe(before);
  });

  it("needs a reason for a manual quantity, and rejects an empty list, repeated lines, bad quantities", async () => {
    const before = await snapshot();
    // 777 can never equal a suggested quantity, so it is a manual quantity and needs a documented reason
    expect((await add([line("LAB-000001", 777, null)])).status).toBe(400);
    expect((await add([line("LAB-000001", 777, "   ")])).status).toBe(400);
    expect((await add([])).status).toBe(400);
    expect((await add("nope")).status).toBe(400);
    expect((await add([line("LAB-000001"), line("LAB-000001")])).status).toBe(400);
    expect((await add([line("LAB-000001", 0)])).status).toBe(400);
    expect((await add([line("LAB-000001", 1.5)])).status).toBe(400);
    expect(await snapshot()).toBe(before);
  });

  it("answers 409 and writes nothing when open orders for the reagent changed after the suggestion was computed", async () => {
    mocks.afterSuggestions = async () => {
      mocks.afterSuggestions = null;
      await insertPurchaseOrder(sql, { poNumber: "PO-RACE", departmentId: DEPT_A, status: "SUBMITTED", itemId: "LAB-000001", quantity: 4, vendor: "Vendor A" });
    };
    const before = await snapshot();
    const response = await add([line("LAB-000001")]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("เปลี่ยนไประหว่างคำนวณ") });
    expect(await snapshot()).toBe(before);
    expect(mocks.recordPurchaseOrderCommunication).not.toHaveBeenCalled();
  });

  it("answers 409 and writes nothing when the order was approved while the lines were being checked", async () => {
    mocks.afterSuggestions = async () => {
      mocks.afterSuggestions = null;
      await sql.db.exec(`UPDATE purchase_orders SET status = 'SUBMITTED' WHERE id = ${poId}`);
    };
    const response = await add([line("LAB-000001")]);
    expect(response.status).toBe(409);
    expect(await itemIds()).toEqual(["A-000002"]);
    expect(mocks.recordPurchaseOrderCommunication).not.toHaveBeenCalled();
  });

  it("adds several lines at once, all or nothing", async () => {
    await sql.db.exec(`UPDATE master_data SET is_active = TRUE WHERE item_id = 'X-LEGACY'`);
    expect((await add([line("LAB-000001"), line("X-LEGACY")])).status).toBe(200);
    expect(await itemIds()).toEqual(["A-000002", "LAB-000001", "X-LEGACY"]);

    await sql.db.exec(`DELETE FROM purchase_order_items WHERE po_id = ${poId} AND item_id <> 'A-000002'`);
    const before = await snapshot();
    expect((await add([line("LAB-000001"), line("MB-000001")])).status).toBe(400); // one bad line sinks the whole request
    expect(await snapshot()).toBe(before);
  });
});

describe("who may add lines", () => {
  it("a Vendor of the same company, signed-out users and plain users are refused", async () => {
    const before = await snapshot();
    mocks.getAuthenticatedUser.mockResolvedValue(vendorA);
    expect((await add([line("LAB-000001")])).status).toBe(403);
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "u", name: "U", role: "User", scope: DEPT_A });
    expect((await add([line("LAB-000001")])).status).toBe(403);
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    expect((await add([line("LAB-000001")])).status).toBe(401);
    expect(await snapshot()).toBe(before);
  });

  it("a manager of another room cannot see the order (404); an Admin viewing all rooms gets DEPARTMENT_READ_ONLY", async () => {
    const before = await snapshot();
    mocks.getAuthenticatedUser.mockResolvedValue(labB);
    expect((await add([line("LAB-000001")])).status).toBe(404);
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    const response = await add([line("LAB-000001")]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DEPARTMENT_READ_ONLY" });
    expect(await snapshot()).toBe(before);
  });
});
