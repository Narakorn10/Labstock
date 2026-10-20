import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";
import baseline from "./purchase-order-overdue.legacy-baseline.json";

// G5 PR-3: overdue reminders by department, with the REAL recordPurchaseOrderCommunication (not mocked) on the production
// schema + v30-v35 (PGlite). `@/lib/db` is wrapped in vi.fn so the SQL text/params of find can be inspected.
vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  const real = createPgliteSql();
  const wrapped = Object.assign(vi.fn((...args: Parameters<typeof real>) => real(...args)), {
    unsafe: real.unsafe,
    transaction: real.transaction,
    db: real.db,
  });
  return { default: wrapped };
});
vi.mock("next/server", () => ({ after: () => { throw new Error("no request scope"); } }));
vi.mock("@/lib/feature-flags", () => ({ SHIPMENTS_ENABLED: false }));

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import type { DepartmentScope } from "@/lib/scoped-db";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables } from "@/test/purchase-order-dept-fixtures";
import { findOverduePurchaseOrders, remindOverduePurchaseOrders } from "./purchase-order-overdue";

const wrapped = dbSql as unknown as PgliteSql & { mock: { calls: unknown[][]; results: Array<{ value: unknown }> } };
const sql = wrapped;
let poA: number;
let poB: number;

const rows = async <T>(query: string, params: unknown[] = []) => (await sql.db.query<T>(query, params)).rows;
const outbox = (poId: number) => rows<{ recipient_username: string; department_id: number }>(
  "SELECT recipient_username, department_id FROM notification_outbox WHERE po_id = $1 ORDER BY recipient_username",
  [poId],
);
const events = () => rows<{ po_number: string; event_type: string; source: string }>(
  "SELECT po_number, event_type, source FROM purchase_order_events ORDER BY po_number",
);
const users = (list: Array<{ recipient_username: string }>) => list.map((row) => row.recipient_username);

beforeAll(async () => {
  process.env.DEPARTMENTS_ENABLED = "true";
  resetDepartmentsFlagForTests();
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
  await sql.db.exec(`
    ALTER TABLE purchase_order_events
      ADD COLUMN from_status TEXT, ADD COLUMN to_status TEXT, ADD COLUMN actor_username TEXT, ADD COLUMN actor_role TEXT,
      ADD COLUMN source TEXT NOT NULL DEFAULT 'WEB', ADD COLUMN visibility TEXT NOT NULL DEFAULT 'BOTH',
      ADD COLUMN note TEXT, ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE notification_settings (
      username TEXT PRIMARY KEY, email TEXT, line_user_id TEXT,
      notify_po_created BOOLEAN, notify_po_confirmed BOOLEAN, notify_po_shipped BOOLEAN,
      notify_po_received BOOLEAN, notify_po_status_updates BOOLEAN
    );
    INSERT INTO users (username, password_hash, name, role, vendor) VALUES
      ('adminA',  'x', 'Admin A',  'Admin',   ''),
      ('adminB',  'x', 'Admin B',  'Admin',   ''),
      ('adminAB', 'x', 'Admin AB', 'Admin',   '');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('adminA', ${DEPT_A}, NULL, true),
      ('adminB', ${DEPT_B}, NULL, true),
      ('adminAB', ${DEPT_A}, NULL, true),
      ('adminAB', ${DEPT_B}, NULL, false);
    INSERT INTO notification_settings (username, email) VALUES
      ('adminA', 'adminA@lab.test'), ('adminB', 'adminB@lab.test'), ('adminAB', 'adminAB@lab.test');
  `);
}, 60_000);

afterAll(async () => {
  delete process.env.DEPARTMENTS_ENABLED;
  resetDepartmentsFlagForTests();
  await sql.db.close();
});

beforeEach(async () => {
  process.env.DEPARTMENTS_ENABLED = "true";
  resetDepartmentsFlagForTests();
  await sql.db.exec(`
    TRUNCATE purchase_order_events, notification_outbox, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;
    INSERT INTO purchase_orders (po_number, vendor, created_by, status, vendor_response_due_at, department_id) VALUES
      ('PO-A-LATE', 'PCL', 'seed', 'SUBMITTED', NOW() - INTERVAL '1 day', ${DEPT_A}),
      ('PO-B-LATE', 'PCL', 'seed', 'SUBMITTED', NOW() - INTERVAL '1 day', ${DEPT_B}),
      ('PO-B-OK',   'PCL', 'seed', 'SUBMITTED', NOW() + INTERVAL '2 days', ${DEPT_B});
  `);
  poA = (await rows<{ id: number }>("SELECT id FROM purchase_orders WHERE po_number = 'PO-A-LATE'"))[0].id;
  poB = (await rows<{ id: number }>("SELECT id FROM purchase_orders WHERE po_number = 'PO-B-LATE'"))[0].id;
});

describe("overdue reminders by department", () => {
  it("mode all reminds both departments; each PO notifies its own department's members with its own department stamped", async () => {
    const reminded = await remindOverduePurchaseOrders({ mode: "all" });

    expect(reminded.map((order) => order.po_number)).toEqual(["PO-A-LATE", "PO-B-LATE"]);
    expect((await events()).map((row) => [row.po_number, row.event_type, row.source])).toEqual([
      ["PO-A-LATE", "VENDOR_RESPONSE_OVERDUE", "SYSTEM"],
      ["PO-B-LATE", "VENDOR_RESPONSE_OVERDUE", "SYSTEM"],
    ]);
    const a = await outbox(poA);
    const b = await outbox(poB);
    expect(users(a)).toEqual(["adminA", "adminAB"]);
    expect(a.map((row) => row.department_id)).toEqual([DEPT_A, DEPT_A]);
    expect(users(b)).toEqual(["adminAB", "adminB"]);
    expect(b.map((row) => row.department_id)).toEqual([DEPT_B, DEPT_B]);
  });

  it("mode one reminds only that department's orders", async () => {
    const reminded = await remindOverduePurchaseOrders({ mode: "one", departmentId: DEPT_A });

    expect(reminded.map((order) => order.po_number)).toEqual(["PO-A-LATE"]);
    expect((await events()).map((row) => row.po_number)).toEqual(["PO-A-LATE"]);
    expect(await outbox(poB)).toEqual([]);
  });

  it("mode one for department B is not mixed up with A", async () => {
    const found = await findOverduePurchaseOrders({ mode: "one", departmentId: DEPT_B });
    expect(found.map((order) => order.po_number)).toEqual(["PO-B-LATE"]);
  });

  it("rejects a malformed scope before running any query", async () => {
    const bad: unknown[] = [undefined, {}, { username: "adminA", role: "Admin" }, { mode: "one" }, { mode: "one", departmentId: "1" }];
    for (const scope of bad) {
      wrapped.mock.calls.length = 0;
      await expect(findOverduePurchaseOrders(scope as DepartmentScope)).rejects.toThrow("findOverduePurchaseOrders requires a DepartmentScope");
      await expect(remindOverduePurchaseOrders(scope as DepartmentScope)).rejects.toThrow("remindOverduePurchaseOrders requires a DepartmentScope");
      expect(wrapped.mock.calls).toHaveLength(0);
    }
  });
});

describe("overdue reminders with the flag off (legacy)", () => {
  beforeEach(() => {
    delete process.env.DEPARTMENTS_ENABLED;
    resetDepartmentsFlagForTests();
  });

  it("find issues the same SQL text and parameters as before departments", async () => {
    wrapped.mock.calls.length = 0;
    wrapped.mock.results.length = 0;
    const found = await findOverduePurchaseOrders({ mode: "legacy" });

    const index = wrapped.mock.calls.findIndex((call) => (call[0] as TemplateStringsArray).join("?").includes("CROSS JOIN LATERAL"));
    expect(index).toBeGreaterThanOrEqual(0);
    const query = wrapped.mock.results[index].value as { text: string; params: unknown[] };
    let n = 0;
    expect(query.text).toBe(baseline.text.replace(/\?/g, () => `$${++n}`));
    expect(query.params).toEqual(baseline.values);
    expect(found.map((order) => order.po_number)).toEqual(["PO-A-LATE", "PO-B-LATE"]);
  });

  it("record behaves as before: every Admin is a recipient and the outbox keeps the column default", async () => {
    await remindOverduePurchaseOrders({ mode: "legacy" });

    // adminA, adminB and adminAB all get both orders (no membership filter), and the seed's admin1 has no notification_settings row.
    expect(users(await outbox(poB))).toEqual(["adminA", "adminAB", "adminB"]);
    expect((await outbox(poB)).map((row) => row.department_id)).toEqual([DEPT_A, DEPT_A, DEPT_A]);
  });
});
