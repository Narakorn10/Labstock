import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of GET/POST /api/purchase-orders on the production schema + v30-v35 (PGlite).

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
import { DEPT_A, DEPT_B, applyMigrationFile, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder } from "@/test/purchase-order-dept-fixtures";
import { GET, POST } from "./route";

const sql = dbSql as unknown as PgliteSql;
const labA = { username: "managera", name: "Manager A", role: "Manager", scope: DEPT_A };
const labB = { username: "managerb", name: "Manager B", role: "Manager", scope: DEPT_B };
const adminAll = { username: "admin1", name: "Admin", role: "Admin", scope: "ALL" };
const legacyManager = { username: "manager1", name: "Manager", role: "Manager" };

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
  await sql.db.exec(`INSERT INTO lab_profile (id, organization_name, department_name) VALUES (1, 'Test Lab', 'Lab Dept') ON CONFLICT DO NOTHING`);
  // v36 + a letterhead row for department B (without one B cannot create POs: see the PO_LETTERHEAD_MISSING test below).
  await applyMigrationFile(sql.db, "upgrade_v36_lab_profile_per_department.sql");
  await insertLabProfileB();
}, 120_000);

const insertLabProfileB = () =>
  sql.db.query(`INSERT INTO lab_profile (id, department_id, organization_name, department_name) VALUES (2, $1, 'MB Organization', 'MB Letterhead Dept')`, [DEPT_B]);

afterAll(async () => {
  await sql.db.close();
});

// PO-A1 (dept A, Vendor A), PO-A2 (dept A, Vendor A, pending manager review), PO-B1 (dept B, Vendor A: the same company
// supplies both departments), PO-B2 (dept B, MB Vendor).
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(labA);
  await sql.db.exec(`TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;`);
  await insertPurchaseOrder(sql, { poNumber: "PO-A1", departmentId: DEPT_A, status: "SUBMITTED", itemId: "A-000002" });
  await insertPurchaseOrder(sql, { poNumber: "PO-A2", departmentId: DEPT_A, status: "PENDING_MANAGER_REVIEW", itemId: "A-000002" });
  await insertPurchaseOrder(sql, { poNumber: "PO-B1", departmentId: DEPT_B, status: "SUBMITTED", itemId: "MB-000001", vendor: "Vendor A" });
  await insertPurchaseOrder(sql, { poNumber: "PO-B2", departmentId: DEPT_B, status: "SUBMITTED", itemId: "MB-000001", vendor: "MB Vendor" });
});

afterEach(() => {
  resetDepartmentsFlagForTests();
});

const list = async (query = "") => {
  const response = await GET(new Request(`http://localhost/api/purchase-orders${query}`));
  return { status: response.status, body: await response.json() as Array<{ po_number: string; department_id?: number; items: unknown[] }> };
};
const numbers = (rows: Array<{ po_number: string }>) => rows.map((row) => row.po_number).sort();

describe("GET /api/purchase-orders (Lab)", () => {
  it("department A sees only its own purchase orders", async () => {
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(numbers(body)).toEqual(["PO-A1", "PO-A2"]);
  });

  it("department B sees only its own purchase orders", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(labB);
    expect(numbers((await list()).body)).toEqual(["PO-B1", "PO-B2"]);
  });

  it("?vendor= is filtered by department too (the same company supplies both departments)", async () => {
    expect(numbers((await list("?vendor=Vendor%20A")).body)).toEqual(["PO-A1", "PO-A2"]);
    mocks.getAuthenticatedUser.mockResolvedValue(labB);
    expect(numbers((await list("?vendor=Vendor%20A")).body)).toEqual(["PO-B1"]);
  });

  it("an Admin viewing all departments sees every purchase order", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    expect(numbers((await list()).body)).toEqual(["PO-A1", "PO-A2", "PO-B1", "PO-B2"]);
    expect(numbers((await list("?vendor=Vendor%20A")).body)).toEqual(["PO-A1", "PO-A2", "PO-B1"]);
  });

  it("with departments off (legacy, no scope on the user) every purchase order is listed as before", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(legacyManager);
    expect(numbers((await list()).body)).toEqual(["PO-A1", "PO-A2", "PO-B1", "PO-B2"]);
    expect(numbers((await list("?vendor=Vendor%20A")).body)).toEqual(["PO-A1", "PO-A2", "PO-B1"]);
  });

  it("a user who asked for a department they are not in gets DEPARTMENT_NOT_FOUND (404), not 500", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...labA, departmentDenied: true });
    const response = await GET(new Request("http://localhost/api/purchase-orders"));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "DEPARTMENT_NOT_FOUND" });
  });
});

describe("GET /api/purchase-orders (Vendor)", () => {
  it("a Vendor sees the orders of its own company across departments (temporarily accepted, question #3 still open)", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "vendor1", name: "Vendor One", role: "Vendor", vendor: "Vendor A", scope: DEPT_A });
    const { status, body } = await list();
    expect(status).toBe(200);
    // PO-A2 is hidden from a Vendor because it is still pending Manager review; PO-B1 is department B's order of the same company.
    expect(numbers(body)).toEqual(["PO-A1", "PO-B1"]);
  });
});

describe("POST /api/purchase-orders", () => {
  const item = (itemId: string, name: string) => ({ item_id: itemId, item_name: name, quantity: 5, unit: "box", override_reason: "test" });
  const post = (user: unknown, body: Record<string, unknown>) => {
    mocks.getAuthenticatedUser.mockResolvedValue(user);
    return POST(new Request("http://localhost/api/purchase-orders", { method: "POST", body: JSON.stringify(body) }));
  };
  const departmentOf = async (poNumber: string) =>
    (await sql.db.query<{ department_id: number }>(`SELECT department_id FROM purchase_orders WHERE po_number = '${poNumber}'`)).rows[0]?.department_id;
  const poCount = async () => Number((await sql.db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM purchase_orders`)).rows[0].n);

  it("a Lab user in department B creates a PO stamped department 2", async () => {
    const response = await post(labB, { vendor: "MB Vendor", items: [item("MB-000001", "Dept B item 1")] });
    expect(response.status).toBe(201);
    const created = await response.json() as { po_number: string };
    expect(await departmentOf(created.po_number)).toBe(DEPT_B);
  });

  it("department B without a letterhead row: 409 PO_LETTERHEAD_MISSING (Thai message and hint) and no PO is added", async () => {
    await sql.db.exec(`DELETE FROM lab_profile WHERE id = 2`);
    try {
      const before = await poCount();
      const response = await post(labB, { vendor: "MB Vendor", items: [item("MB-000001", "Dept B item 1")] });
      expect(response.status).toBe(409);
      const body = await response.json() as { code: string; error: string; hint: string };
      expect(body).toMatchObject({ code: "PO_LETTERHEAD_MISSING", error: "ยังไม่ได้ตั้งหัวกระดาษใบสั่งซื้อของงานนี้ กรุณาติดต่อผู้ดูแลระบบ" });
      expect(body.hint).toMatch(/\S/);
      expect(await poCount()).toBe(before);
      expect(mocks.recordPurchaseOrderCommunication).not.toHaveBeenCalled();
    } finally {
      await insertLabProfileB();
    }
  });

  it("a Lab user in department A cannot order department B's item", async () => {
    const before = await poCount();
    const response = await post(labA, { vendor: "MB Vendor", items: [item("MB-000001", "Dept B item 1")] });
    expect(response.status).toBe(400);
    expect(await poCount()).toBe(before);
  });

  it("an Admin viewing all departments cannot create: 409 DEPARTMENT_READ_ONLY and nothing is written", async () => {
    const before = await poCount();
    const response = await post(adminAll, { vendor: "Vendor A", items: [item("A-000002", "Dept A extra item")] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DEPARTMENT_READ_ONLY" });
    expect(await poCount()).toBe(before);
  });

  it("a Vendor proposes with its own resolved department scope", async () => {
    const response = await post(
      { username: "vendor2", name: "Vendor Two", role: "Vendor", vendor: "MB Vendor", scope: DEPT_B },
      { vendor: "MB Vendor", items: [item("MB-000001", "Dept B item 1")] },
    );
    expect(response.status).toBe(201);
    const created = await response.json() as { po_number: string };
    expect(await departmentOf(created.po_number)).toBe(DEPT_B);
  });

  it("the permission check (403) comes before any department error", async () => {
    const before = await poCount();
    const response = await post(
      { username: "plain", name: "Plain", role: "User", scope: DEPT_A, departmentDenied: true },
      { vendor: "Vendor A", items: [item("A-000002", "Dept A extra item")] },
    );
    expect(response.status).toBe(403);
    expect(await poCount()).toBe(before);
  });

  it("a Lab user who asked for a department they are not in gets DEPARTMENT_NOT_FOUND (404)", async () => {
    const response = await post({ ...labA, departmentDenied: true }, { vendor: "Vendor A", items: [item("A-000002", "Dept A extra item")] });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "DEPARTMENT_NOT_FOUND" });
  });
});
