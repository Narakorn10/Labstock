import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of the 4 LIFF ordering routes with DEPARTMENTS_ENABLED=true, on the production schema +
// v30-v36 (PGlite). Real: line-liff-ordering, line-liff-auth (only verifyLineIdToken is replaced), department-context,
// scoped-db, getPurchaseOrderSuggestions and createPurchaseOrderWithAudit. Mocked: verifyLineIdToken, recordPurchaseOrderCommunication.
//
// LIMIT: PGlite only. Never run against Neon: check the scoped queries on real Neon at rehearsal before enabling the flag.

const mocks = vi.hoisted(() => ({
  verifyLineIdToken: vi.fn(),
  recordPurchaseOrderCommunication: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql(new PGlite({ parsers: { [types.DATE]: (value: string) => value } })) };
});
vi.mock("@/lib/line-liff-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/line-liff-auth")>()),
  verifyLineIdToken: mocks.verifyLineIdToken,
}));
vi.mock("@/lib/po-communication", () => ({ recordPurchaseOrderCommunication: mocks.recordPurchaseOrderCommunication }));

import dbSql from "@/lib/db";
import { resetDepartmentContextForTests } from "@/lib/department-context";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { DEPT_A, DEPT_B, applyMigrationFile, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder } from "@/test/purchase-order-dept-fixtures";
import { POST as bootstrapPOST } from "./bootstrap/route";
import { POST as catalogPOST } from "./catalog/search/route";

const sql = dbSql as unknown as PgliteSql;
const noWork = "บัญชีนี้ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ";
const notAllowed = "Only linked Admin or Manager users can order reagents from LINE.";

// Every user below has users.line_user_id = "U-<username>" (the fake id token is "tok:U-<username>").
//   mgra                 Manager, member of A (default)
//   mgrb                 Manager, member of B (default)
//   mgr-user-override    global Manager, B default with user_departments.role = 'User'
//   mgr-vendor-override  global Manager, B default with user_departments.role = 'Vendor'
//   mgrnone              Manager, no membership row
//   admin1               global Admin (seed), member of A
beforeAll(async () => {
  vi.stubEnv("DEPARTMENTS_ENABLED", "true");
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
  await sql.db.exec(`INSERT INTO lab_profile (id, organization_name, department_name) VALUES (1, 'Test Lab', 'Lab Dept') ON CONFLICT DO NOTHING`);
  // v36 + a letterhead row for department B (without one B cannot create POs).
  await applyMigrationFile(sql.db, "upgrade_v36_lab_profile_per_department.sql");
  await sql.db.query(`INSERT INTO lab_profile (id, department_id, organization_name, department_name) VALUES (2, $1, 'MB Organization', 'MB Letterhead Dept')`, [DEPT_B]);
  await sql.db.exec(`
    INSERT INTO users (username, password_hash, name, role, vendor) VALUES
      ('mgra', 'x', 'Manager A', 'Manager', ''),
      ('mgrb', 'x', 'Manager B', 'Manager', ''),
      ('mgr-user-override', 'x', 'Manager User Override', 'Manager', ''),
      ('mgr-vendor-override', 'x', 'Manager Vendor Override', 'Manager', ''),
      ('mgrnone', 'x', 'Manager No Membership', 'Manager', '');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('mgra', ${DEPT_A}, NULL, true),
      ('mgrb', ${DEPT_B}, NULL, true),
      ('mgr-user-override', ${DEPT_B}, 'User', true),
      ('mgr-vendor-override', ${DEPT_B}, 'Vendor', true);
    UPDATE users SET line_user_id = 'U-' || username WHERE username IN ('mgra', 'mgrb', 'mgr-user-override', 'mgr-vendor-override', 'mgrnone', 'admin1');
  `);
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await sql.db.close();
});

// PO-A (dept A, Vendor A, SUBMITTED), PO-B (dept B, MB Vendor, SUBMITTED), PO-A-REV / PO-B-REV (REVISION_REQUESTED, waiting for the Lab).
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  resetDepartmentsFlagForTests();
  resetDepartmentContextForTests();
  mocks.verifyLineIdToken.mockImplementation(async (token: string) => (token.startsWith("tok:") ? { sub: token.slice(4) } : null));
  mocks.recordPurchaseOrderCommunication.mockResolvedValue(undefined);
  await sql.db.exec(`TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;`);
  await insertPurchaseOrder(sql, { poNumber: "PO-A", departmentId: DEPT_A, status: "SUBMITTED", vendor: "Vendor A", itemId: "A-000002" });
  await insertPurchaseOrder(sql, { poNumber: "PO-B", departmentId: DEPT_B, status: "SUBMITTED", vendor: "MB Vendor", itemId: "MB-000001" });
  await insertPurchaseOrder(sql, { poNumber: "PO-A-REV", departmentId: DEPT_A, status: "REVISION_REQUESTED", vendor: "Vendor A", itemId: "A-000002" });
  await insertPurchaseOrder(sql, { poNumber: "PO-B-REV", departmentId: DEPT_B, status: "REVISION_REQUESTED", vendor: "MB Vendor", itemId: "MB-000001" });
});

afterEach(() => {
  resetDepartmentsFlagForTests();
});

const tokenOf = (username: string) => `tok:U-${username}`;
const req = (username: string, body: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/liff/orders", { method: "POST", body: JSON.stringify({ idToken: tokenOf(username), ...body }) });
const json = async (response: Response) => ({ status: response.status, body: await response.json() as Record<string, unknown> });

const bootstrap = async (username: string) => {
  const { status, body } = await json(await bootstrapPOST(req(username)));
  return {
    status,
    body,
    vendors: ((body.vendors ?? []) as Array<{ vendor: string }>).map((row) => row.vendor).sort(),
    orders: ((body.orders ?? []) as Array<{ po_number: string }>).map((row) => row.po_number).sort(),
  };
};
const catalog = async (username: string, body: Record<string, unknown>) => {
  const { status, body: rows } = await json(await catalogPOST(req(username, body)));
  return { status, rows: rows as unknown as Array<{ item_id: string }> };
};

describe("fixture controls (the data the assertions below rely on really exists)", () => {
  it("both departments have vendors, items and POs in the database", async () => {
    const count = async (query: string) => Number((await sql.db.query<{ n: number }>(query)).rows[0].n);
    expect(await count(`SELECT count(*)::int AS n FROM master_data WHERE vendor = 'Vendor A' AND department_id = ${DEPT_A}`)).toBeGreaterThan(0);
    expect(await count(`SELECT count(*)::int AS n FROM master_data WHERE vendor = 'MB Vendor' AND department_id = ${DEPT_B}`)).toBeGreaterThan(0);
    expect(await count(`SELECT count(*)::int AS n FROM purchase_orders WHERE po_number = 'PO-A' AND department_id = ${DEPT_A}`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM purchase_orders WHERE po_number = 'PO-B' AND department_id = ${DEPT_B}`)).toBe(1);
  });
});

describe("POST /api/liff/orders/catalog/search (departments on)", () => {
  it("a department A Manager searching Vendor A sees the A catalogue; the MB Vendor catalogue of B is not visible (404-style empty)", async () => {
    const positive = await catalog("mgra", { vendor: "Vendor A", suggestOnly: false });
    expect(positive.status).toBe(200);
    expect(positive.rows.map((row) => row.item_id).sort()).toEqual(["A-000002", "LAB-000001", "X-LEGACY"]);

    const other = await catalog("mgra", { vendor: "MB Vendor", suggestOnly: false });
    expect(other.status).toBe(200);
    expect(other.rows).toEqual([]);
  });

  it("a department B Manager sees only the catalogue of B", async () => {
    const positive = await catalog("mgrb", { vendor: "MB Vendor", suggestOnly: false });
    expect(positive.status).toBe(200);
    expect(positive.rows.map((row) => row.item_id).sort()).toEqual(["MB-000001", "MB-000002"]);

    const other = await catalog("mgrb", { vendor: "Vendor A", suggestOnly: false });
    expect(other.status).toBe(200);
    expect(other.rows).toEqual([]);
  });

  it("a keyword search is scoped too", async () => {
    expect((await catalog("mgrb", { vendor: "MB Vendor", keyword: "Dept B item 1" })).rows.map((row) => row.item_id)).toEqual(["MB-000001"]);
    expect((await catalog("mgra", { vendor: "MB Vendor", keyword: "Dept B item 1" })).rows).toEqual([]);
  });

  it("a Manager without any membership gets 403 with the Thai message (no catalogue)", async () => {
    const { status, body } = await json(await catalogPOST(req("mgrnone", { vendor: "Vendor A", suggestOnly: false })));
    expect(status).toBe(403);
    expect(body).toEqual({ error: noWork });
  });

  it("a per-department role override of User or Vendor cannot read the catalogue (403)", async () => {
    for (const username of ["mgr-user-override", "mgr-vendor-override"]) {
      const { status, body } = await json(await catalogPOST(req(username, { vendor: "MB Vendor", suggestOnly: false })));
      expect(status, username).toBe(403);
      expect(body, username).toEqual({ error: notAllowed });
    }
  });
});

describe("POST /api/liff/orders/bootstrap (departments on)", () => {
  it("a department A Manager sees the vendors and open orders of A only", async () => {
    const a = await bootstrap("mgra");
    expect(a.status).toBe(200);
    expect(a.vendors).toContain("Vendor A"); // positive control
    expect(a.orders).toEqual(["PO-A", "PO-A-REV"]);
    expect(a.vendors).not.toContain("MB Vendor");
  });

  it("a department B Manager sees the vendors and open orders of B only", async () => {
    const b = await bootstrap("mgrb");
    expect(b.status).toBe(200);
    expect(b.vendors).toEqual(["MB Vendor"]); // positive control
    expect(b.orders).toEqual(["PO-B", "PO-B-REV"]);
    expect((b.body.orders as Array<{ po_number: string; items: unknown[] }>).every((order) => order.items.length === 1)).toBe(true);
  });

  it("the user in the answer holds only username, name and role", async () => {
    const { body } = await bootstrap("mgrb");
    expect(Object.keys(body.user as object).sort()).toEqual(["name", "role", "username"]);
    expect(body.user).toEqual({ username: "mgrb", name: "Manager B", role: "Manager" });
  });

  it("a Manager without membership gets 403 with the Thai message", async () => {
    const { status, body } = await bootstrap("mgrnone");
    expect(status).toBe(403);
    expect(body).toEqual({ error: noWork });
  });
});
