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
import { POST as ordersPOST } from "./route";
import { PATCH as orderPATCH } from "./[id]/route";

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
//   user1                global User (seed), member of A: cannot order from LINE
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
    UPDATE users SET line_user_id = 'U-' || username WHERE username IN ('mgra', 'mgrb', 'mgr-user-override', 'mgr-vendor-override', 'mgrnone', 'admin1', 'user1');
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
const patch = async (username: string, id: string | number, body: Record<string, unknown>) => {
  const response = await orderPATCH(
    new Request(`http://localhost/api/liff/orders/${id}`, { method: "PATCH", body: JSON.stringify({ idToken: tokenOf(username), ...body }) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return json(response);
};
const create = async (username: string, body: Record<string, unknown>) => json(await ordersPOST(req(username, body)));
const poCount = async () => Number((await sql.db.query<{ n: number }>("SELECT count(*)::int AS n FROM purchase_orders")).rows[0].n);
const orderB = { vendor: "MB Vendor", items: [{ item_id: "MB-000001", item_name: "Dept B item 1", quantity: 3, unit: "box", override_reason: "test" }] };
const orderA = { vendor: "Vendor A", items: [{ item_id: "A-000002", item_name: "Dept A extra item", quantity: 2, unit: "box", override_reason: "test" }] };
const poRow = async (poNumber: string) =>
  (await sql.db.query<{ id: number; status: string; reviewed_by: string | null; department_id: number }>(
    `SELECT id, status, reviewed_by, department_id FROM purchase_orders WHERE po_number = $1`, [poNumber])).rows[0];
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

describe("PATCH /api/liff/orders/[id] (departments on)", () => {
  it("positive control: a Manager reviews a revision of their own department (by id and by po_number)", async () => {
    const a = await poRow("PO-A-REV");
    const byId = await patch("mgra", a.id, { action: "APPROVE_REVISION" });
    expect(byId.status).toBe(200);
    expect(byId.body).toMatchObject({ po_number: "PO-A-REV", status: "CONFIRMED" });
    expect(await poRow("PO-A-REV")).toMatchObject({ status: "CONFIRMED", reviewed_by: "mgra" });

    const byNumber = await patch("mgrb", "PO-B-REV", { action: "REJECT_REVISION" });
    expect(byNumber.status).toBe(200);
    expect(await poRow("PO-B-REV")).toMatchObject({ status: "REJECTED", reviewed_by: "mgrb" });
  });

  it("a PO of another department answers 404 (by id and by po_number) and does not change", async () => {
    const b = await poRow("PO-B-REV");
    expect(b).toMatchObject({ status: "REVISION_REQUESTED", department_id: DEPT_B }); // control: it exists, in B, waiting for review

    const byId = await patch("mgra", b.id, { action: "APPROVE_REVISION" });
    expect(byId.status).toBe(404);
    expect(byId.body).toEqual({ error: "Purchase order not found." });
    const byNumber = await patch("mgra", "PO-B-REV", { action: "APPROVE_REVISION" });
    expect(byNumber.status).toBe(404);
    expect(byNumber.body).toEqual({ error: "Purchase order not found." });

    expect(await poRow("PO-B-REV")).toMatchObject({ status: "REVISION_REQUESTED", reviewed_by: null });
    // and the other way round
    const a = await poRow("PO-A-REV");
    expect((await patch("mgrb", a.id, { action: "REJECT_REVISION" })).status).toBe(404);
    expect((await patch("mgrb", "PO-A-REV", { action: "REJECT_REVISION" })).status).toBe(404);
    expect(await poRow("PO-A-REV")).toMatchObject({ status: "REVISION_REQUESTED", reviewed_by: null });
  });

  it("a Manager without membership gets 403 and a User/Vendor override cannot review (PO unchanged)", async () => {
    const none = await patch("mgrnone", "PO-B-REV", { action: "APPROVE_REVISION" });
    expect(none.status).toBe(403);
    expect(none.body).toEqual({ error: noWork });
    for (const username of ["mgr-user-override", "mgr-vendor-override"]) {
      const denied = await patch(username, "PO-B-REV", { action: "APPROVE_REVISION" });
      expect(denied.status, username).toBe(403);
      expect(denied.body, username).toEqual({ error: notAllowed });
    }
    expect(await poRow("PO-B-REV")).toMatchObject({ status: "REVISION_REQUESTED", reviewed_by: null });
  });
});

describe("POST /api/liff/orders (departments on)", () => {
  it("creates the PO in the department of the LINE user (B => department_id 2, A => department_id 1)", async () => {
    const b = await create("mgrb", orderB);
    expect(b.status).toBe(201);
    const created = await poRow(String(b.body.po_number));
    expect(created).toMatchObject({ status: "PENDING_MANAGER_REVIEW", department_id: DEPT_B });
    // the letterhead snapshot comes from the row of department B (v36), not from CC
    const issuer = (await sql.db.query<{ issuer_name: string }>("SELECT issuer_name FROM purchase_orders WHERE id = $1", [created.id])).rows[0];
    expect(issuer.issuer_name).toBe("MB Organization");

    const a = await create("mgra", orderA);
    expect(a.status).toBe(201);
    expect(await poRow(String(a.body.po_number))).toMatchObject({ department_id: DEPT_A });
    expect(mocks.recordPurchaseOrderCommunication).toHaveBeenCalledTimes(2);
  });

  it("a vendor / item of another department answers 400 and creates nothing", async () => {
    const before = await poCount();
    const crossB = await create("mgra", orderB); // positive control above: mgrb can order exactly this
    expect(crossB.status).toBe(400);
    expect(String(crossB.body.error)).toContain("MB Vendor");
    const crossA = await create("mgrb", orderA);
    expect(crossA.status).toBe(400);
    expect(await poCount()).toBe(before);
  });

  it("a department without a letterhead row answers 409 PO_LETTERHEAD_MISSING with a readable Thai body.error and creates nothing", async () => {
    await sql.db.query("DELETE FROM lab_profile WHERE department_id = $1", [DEPT_B]);
    try {
      const before = await poCount();
      const result = await create("mgrb", orderB);
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ code: "PO_LETTERHEAD_MISSING", error: "ยังไม่ได้ตั้งหัวกระดาษใบสั่งซื้อของงานนี้ กรุณาติดต่อผู้ดูแลระบบ" });
      expect(typeof result.body.hint).toBe("string");
      expect(typeof result.body.requestId).toBe("string");
      expect(await poCount()).toBe(before);
      // control: department A still has its letterhead and can create
      expect((await create("mgra", orderA)).status).toBe(201);
    } finally {
      await sql.db.query("INSERT INTO lab_profile (id, department_id, organization_name, department_name) VALUES (2, $1, 'MB Organization', 'MB Letterhead Dept')", [DEPT_B]);
    }
  });

  it("a role override of User / Vendor and a Manager without membership cannot create (403, nothing created)", async () => {
    const before = await poCount();
    for (const username of ["mgr-user-override", "mgr-vendor-override"]) {
      const denied = await create(username, orderB);
      expect(denied.status, username).toBe(403);
      expect(denied.body, username).toEqual({ error: notAllowed });
    }
    const none = await create("mgrnone", orderB);
    expect(none.status).toBe(403);
    expect(none.body).toEqual({ error: noWork });
    expect(await poCount()).toBe(before);
  });

  it("the 400 for an empty vendor / items still comes before any department work", async () => {
    expect((await create("mgrb", { ...orderB, vendor: " " })).status).toBe(400);
    expect((await create("mgrb", { vendor: "MB Vendor", items: [] })).status).toBe(400);
  });

  describe("liffRequestId dedupe", () => {
    beforeEach(async () => {
      await sql.db.exec(`UPDATE purchase_orders SET liff_request_id = 'dup-B' WHERE po_number = 'PO-B'`);
    });

    it("the same department gets the existing PO back (deduplicated)", async () => {
      const result = await create("mgrb", { ...orderB, liffRequestId: "dup-B" });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ po_number: "PO-B", deduplicated: true });
    });

    it("a request id used by another department is not looked up across departments: 500, no PO number of B in the body, no new row", async () => {
      const before = await poCount();
      const result = await create("mgra", { ...orderA, liffRequestId: "dup-B" });
      expect(result.status).toBe(500); // the unique index on liff_request_id is global: accepted, documented in departments-rollout.md
      expect(JSON.stringify(result.body)).not.toContain("PO-B");
      expect(result.body).toEqual({ error: "Unable to submit purchase order from LINE." });
      expect(await poCount()).toBe(before);
    });
  });
});

describe("Admin, closed departments, database errors and auth (departments on)", () => {
  it("a global Admin without a membership row works in the lowest-id active department (never ALL) and can write", async () => {
    await sql.db.exec(`DELETE FROM user_departments WHERE username = 'admin1'`);
    try {
      const view = await bootstrap("admin1");
      expect(view.status).toBe(200);
      expect(view.orders).toEqual(["PO-A", "PO-A-REV"]);
      expect(view.vendors).not.toContain("MB Vendor");
      expect(view.body.user).toEqual({ username: "admin1", name: "Admin One", role: "Admin" });

      const created = await create("admin1", orderA);
      expect(created.status).toBe(201);
      expect(await poRow(String(created.body.po_number))).toMatchObject({ department_id: DEPT_A });
      expect((await patch("admin1", "PO-A-REV", { action: "APPROVE_REVISION" })).status).toBe(200);
      expect((await patch("admin1", "PO-B-REV", { action: "APPROVE_REVISION" })).status).toBe(404);
    } finally {
      await sql.db.exec(`INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('admin1', ${DEPT_A}, NULL, true)`);
    }
  });

  it("a deactivated department locks its members out (403 with the Thai message) on every route", async () => {
    expect((await bootstrap("mgrb")).status).toBe(200); // control: B works while active
    await sql.db.exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_B}`);
    try {
      expect(await json(await bootstrapPOST(req("mgrb")))).toEqual({ status: 403, body: { error: noWork } });
      expect(await json(await catalogPOST(req("mgrb", { vendor: "MB Vendor" })))).toEqual({ status: 403, body: { error: noWork } });
      expect(await create("mgrb", orderB)).toEqual({ status: 403, body: { error: noWork } });
      expect(await patch("mgrb", "PO-B-REV", { action: "APPROVE_REVISION" })).toEqual({ status: 403, body: { error: noWork } });
      expect((await bootstrap("mgra")).status).toBe(200); // A is unaffected
    } finally {
      await sql.db.exec(`UPDATE departments SET is_active = true WHERE id = ${DEPT_B}`);
    }
  });

  it("a generic database error in the department lookup answers 500 with each route's own message and never reaches the data queries", async () => {
    const original = sql.db.query.bind(sql.db) as (text: string, params?: unknown[]) => Promise<unknown>;
    const seen: string[] = [];
    vi.spyOn(sql.db, "query").mockImplementation((async (text: string, params?: unknown[]) => {
      seen.push(text);
      if (/LATERAL/.test(text)) throw Object.assign(new Error("statement timeout"), { code: "57014" });
      return original(text, params);
    }) as never);

    const reviewRequest = new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ idToken: tokenOf("mgrb"), action: "APPROVE_REVISION" }) });
    const results = [
      [await bootstrapPOST(req("mgrb")), "Unable to load LINE ordering workspace."],
      [await catalogPOST(req("mgrb", { vendor: "MB Vendor" })), "Unable to search reagent catalog."],
      [await ordersPOST(req("mgrb", orderB)), "Unable to submit purchase order from LINE."],
      [await orderPATCH(reviewRequest, { params: Promise.resolve({ id: "PO-B-REV" }) }), "Unable to review purchase order from LINE."],
    ] as const;
    for (const [response, message] of results) {
      expect(await json(response)).toEqual({ status: 500, body: { error: message } });
    }
    vi.restoreAllMocks();
    expect(seen.some((text) => /LATERAL/.test(text))).toBe(true); // control: the failing lookup really ran
    expect(seen.filter((text) => /FROM\s+(master_data|purchase_orders)\b/i.test(text))).toEqual([]);
    expect(await poRow("PO-B-REV")).toMatchObject({ status: "REVISION_REQUESTED" });
  });

  it.each(["true", ""])("auth answers are the same with DEPARTMENTS_ENABLED=%j: 401 bad token, 400 no LINE column, 403 unlinked / not an ordering role", async (flag) => {
    vi.stubEnv("DEPARTMENTS_ENABLED", flag);
    resetDepartmentsFlagForTests();
    try {
      expect(await json(await bootstrapPOST(req("mgrb", { idToken: "bad" })))).toEqual({ status: 401, body: { error: "LINE authentication failed." } });
      const unlinked = new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ idToken: "tok:U-nobody" }) });
      expect(await json(await bootstrapPOST(unlinked))).toEqual({ status: 403, body: { error: notAllowed } });
      expect(await json(await bootstrapPOST(req("user1")))).toEqual({ status: 403, body: { error: notAllowed } });

      const original = sql.db.query.bind(sql.db) as (text: string, params?: unknown[]) => Promise<unknown>;
      vi.spyOn(sql.db, "query").mockImplementation((async (text: string, params?: unknown[]) =>
        /column_name = 'line_user_id'/.test(text) ? { rows: [{ exists: false }] } : original(text, params)) as never);
      expect(await json(await bootstrapPOST(req("mgrb")))).toEqual({
        status: 400,
        body: { error: "LINE LIFF ordering is not enabled yet. Run upgrade_v9_line_liff_auth.sql first." },
      });
      vi.restoreAllMocks();
      expect((await bootstrap("mgrb")).status).toBe(200); // control: a valid user still works in this mode
    } finally {
      vi.stubEnv("DEPARTMENTS_ENABLED", "true");
      resetDepartmentsFlagForTests();
    }
  });
});
