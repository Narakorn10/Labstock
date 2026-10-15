import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite, types } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// getPurchaseOrderSuggestions per department, against a real in-memory Postgres with the production schema + v30-v35.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});

import { getPurchaseOrderSuggestions } from "./purchase-order-suggestions";

let db: PgliteSql;
const seenSql: string[] = [];
const DISPENSE = "เบิกไปหน้างาน";

const all = { includeAll: true, includeUnconfigured: true };
const idsOf = (rows: Array<{ item_id: string }>) => rows.map((row) => row.item_id).sort();
const A_ITEMS = ["A-000002", "LAB-000001", "LAB-000002", "X-LEGACY"];
const B_ITEMS = ["MB-000001", "MB-000002"];

beforeAll(async () => {
  db = createPgliteSql(new PGlite({ parsers: { [types.DATE]: (value: string) => value } }));
  await seedTwoDepartments(db);
  // Not part of the shared production fixture: the two tables the suggestions query reads besides the department tables.
  await db.db.exec(`
    CREATE TABLE purchase_order_items (
      id SERIAL PRIMARY KEY, po_id INT REFERENCES purchase_orders(id), item_id TEXT, item_name TEXT, quantity NUMERIC,
      unit TEXT, received_qty NUMERIC
    );
    CREATE TABLE reagent_order_policy (
      item_id TEXT PRIMARY KEY, tests_per_box NUMERIC, avg_patient_tests_per_month NUMERIC NOT NULL DEFAULT 0,
      iqc_tests_per_month NUMERIC NOT NULL DEFAULT 0, documented_actual_withdrawal_boxes NUMERIC,
      approved_monthly_target_boxes NUMERIC, approved_order_qty_boxes NUMERIC, orders_per_month NUMERIC NOT NULL DEFAULT 2,
      lead_time_days INTEGER NOT NULL DEFAULT 7, safety_stock_boxes NUMERIC, min_order_qty_boxes INTEGER NOT NULL DEFAULT 1,
      order_multiple_boxes INTEGER NOT NULL DEFAULT 1, review_days INTEGER, enabled BOOLEAN NOT NULL DEFAULT TRUE,
      source_verification_status TEXT NOT NULL DEFAULT 'VERIFIED', revision INTEGER NOT NULL DEFAULT 1
    );
  `);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

// Department A: LAB-000001, LAB-000002, X-LEGACY, A-000002. Department B: MB-000001, MB-000002.
// A has an open PO for LAB-000001 (qty 10, no ETA); B has one for MB-000001 (qty 4, no ETA).
beforeEach(async () => {
  seenSql.length = 0;
  h.target = db as unknown as Impl;
  await db.db.exec(`
    DELETE FROM purchase_order_items;
    DELETE FROM shipments;
    DELETE FROM shipment_batches;
    DELETE FROM purchase_orders WHERE po_number LIKE 'SUG-%';
    DELETE FROM logs;
    DELETE FROM inventory;
    DELETE FROM reagent_order_policy;
    UPDATE master_data SET is_active = TRUE;
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('LAB-000001', 'LA1', CURRENT_DATE + 200, 3, '2026-09-01', ${DEPT_A}),
      ('MB-000001', 'LB1', CURRENT_DATE + 200, 7, '2026-09-01', ${DEPT_B});
    INSERT INTO logs (item_id, name, lot_no, action, quantity, username, department_id) VALUES
      ('LAB-000001', 'Reagent 1', 'LA1', '${DISPENSE}', 2, 'solo1', ${DEPT_A}),
      ('MB-000001', 'Dept B item 1', 'LB1', '${DISPENSE}', 5, 'solo2', ${DEPT_B});
    INSERT INTO purchase_orders (po_number, vendor, created_by, status, department_id) VALUES
      ('SUG-A-1', 'Vendor A', 'admin1', 'SUBMITTED', ${DEPT_A}),
      ('SUG-B-1', 'MB Vendor', 'solo2', 'SUBMITTED', ${DEPT_B});
    INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, received_qty)
      SELECT id, 'LAB-000001', 'Reagent 1', 10, 0 FROM purchase_orders WHERE po_number = 'SUG-A-1';
    INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, received_qty)
      SELECT id, 'MB-000001', 'Dept B item 1', 4, 0 FROM purchase_orders WHERE po_number = 'SUG-B-1';
  `);
});

describe("getPurchaseOrderSuggestions by department", () => {
  it("department A sees only its own items; B only its own; ALL sees both", async () => {
    const a = await getPurchaseOrderSuggestions(db as never, all, { mode: "one", departmentId: DEPT_A });
    expect(idsOf(a)).toEqual(A_ITEMS);
    const b = await getPurchaseOrderSuggestions(db as never, all, { mode: "one", departmentId: DEPT_B });
    expect(idsOf(b)).toEqual(B_ITEMS);
    const everything = await getPurchaseOrderSuggestions(db as never, all, { mode: "all" });
    expect(idsOf(everything)).toEqual([...A_ITEMS, ...B_ITEMS].sort());
  });

  it("an on-order PO of A does not appear in B's suggestions (and vice versa)", async () => {
    const a = await getPurchaseOrderSuggestions(db as never, all, { mode: "one", departmentId: DEPT_A });
    const b = await getPurchaseOrderSuggestions(db as never, all, { mode: "one", departmentId: DEPT_B });
    expect(a.find((row) => row.item_id === "LAB-000001")).toMatchObject({ committed_no_eta_qty: 10 });
    expect(b.find((row) => row.item_id === "MB-000001")).toMatchObject({ committed_no_eta_qty: 4 });
    expect(b.some((row) => row.item_id === "LAB-000001")).toBe(false);
    expect(a.some((row) => row.item_id === "MB-000001")).toBe(false);
  });

  it("inventory and dispense usage are limited to the department's own rows", async () => {
    // A's own dispensing: 2 today (beforeEach) + 6 ten days ago => 8 over an 11-day span, 2 calendar days (live usage eligible).
    // Stray rows stamped department B for an item owned by A must not count for A: B's stray log sits INSIDE the 14-day
    // window (3 days ago), so a leak would raise dispensed_14d to 48 and the observed calendar days to 3.
    await db.db.exec(`
      INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id)
        VALUES ('LAB-000001', 'STRAY', CURRENT_DATE + 100, 50, '2026-09-01', ${DEPT_B});
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username, department_id, timestamp)
        VALUES ('LAB-000001', 'Reagent 1', 'LA1', '${DISPENSE}', 6, 'solo1', ${DEPT_A}, NOW() - INTERVAL '10 days');
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username, department_id, timestamp)
        VALUES ('LAB-000001', 'Reagent 1', 'STRAY', '${DISPENSE}', 40, 'solo2', ${DEPT_B}, NOW() - INTERVAL '3 days');
    `);
    const a = await getPurchaseOrderSuggestions(db as never, { ...all, itemIds: ["LAB-000001"] }, { mode: "one", departmentId: DEPT_A });
    expect(a).toHaveLength(1);
    expect(Number(a[0].quantity)).toBe(3);
    expect(a[0].data_quality).toMatchObject({ observation_span_days: 11, observed_calendar_days: 2, live_usage_eligible: true });
    expect(a[0].calculation_breakdown.demandSource).toBe("actual_dispense_history");
    expect(a[0].monthly_target_boxes).toBeCloseTo((8 / 11) * 30, 1); // 8 boxes in 11 days, NOT (8 + 40)
    const b = await getPurchaseOrderSuggestions(db as never, { ...all, itemIds: ["LAB-000001"] }, { mode: "one", departmentId: DEPT_B });
    expect(b).toEqual([]); // the item belongs to A: the master_data filter hides it from B
  });

  // Parity with PO creation: purchase-order-creation.ts recomputes current_open in one big INSERT ... SELECT and compares it
  // with the snapshot taken from THIS function (snapshot_on_order_qty / snapshot_no_eta_qty). The two queries cannot be run
  // side by side without a full creation fixture, so the invariant is pinned in two places instead: this test fixes that
  // on_order is NOT department-filtered (legacy and department scope return the same on-order figures for A's item), and
  // purchase-order-creation.ts carries TODO(PR-2) comments saying both queries must change together.
  // A PO stamped department B that contains an item owned by A. The on_order CTE must still count it for A (item_id is a
  // global key; filtering purchase_orders by department would diverge from purchase-order-creation.ts and cause a 409).
  // Run in both SQL branches (with and without reagent_order_policy), since each has its own on_order CTE.
  describe.each([
    ["policy table present", false],
    ["policy table absent", true],
  ])("on_order / no_eta are identical in legacy and department scope (%s)", (_name, dropPolicy) => {
    it("counts a PO stamped for another department that holds A's item", async () => {
      await db.db.exec(`
        INSERT INTO purchase_orders (po_number, vendor, created_by, status, department_id)
          VALUES ('SUG-B-2', 'MB Vendor', 'solo2', 'SUBMITTED', ${DEPT_B});
        INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, received_qty)
          SELECT id, 'LAB-000001', 'Reagent 1', 6, 0 FROM purchase_orders WHERE po_number = 'SUG-B-2';
      `);
      if (dropPolicy) await db.db.exec("ALTER TABLE reagent_order_policy RENAME TO reagent_order_policy_off");
      try {
        const legacy = await getPurchaseOrderSuggestions(db as never, { ...all, itemIds: ["LAB-000001"] }, { mode: "legacy" });
        const one = await getPurchaseOrderSuggestions(db as never, { ...all, itemIds: ["LAB-000001"] }, { mode: "one", departmentId: DEPT_A });
        expect(legacy[0].on_order_qty).toBe(one[0].on_order_qty);
        expect(legacy[0].committed_no_eta_qty).toBe(16); // A's own 10 + the B-stamped PO's 6
        expect(one[0].committed_no_eta_qty).toBe(16);
      } finally {
        if (dropPolicy) await db.db.exec("ALTER TABLE reagent_order_policy_off RENAME TO reagent_order_policy");
      }
    });
  });

  it.each([
    ["undefined", undefined],
    ["an empty object", {}],
    ["a user object", { username: "admin1", role: "Admin" }],
    ["mode one without an id", { mode: "one" }],
    ["mode one with a string id", { mode: "one", departmentId: "1" }],
  ])("a wrong scope argument (%s) throws before any query is issued", async (_name, bad) => {
    const spy = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        seenSql.push(strings.join("?"));
        return db(strings, ...values);
      },
      { unsafe: (text: string) => db.unsafe(text) },
    );
    await expect(getPurchaseOrderSuggestions(spy as never, all, bad as never)).rejects.toThrow("requires a DepartmentScope");
    expect(seenSql).toEqual([]);
  });
});

describe("flag OFF (legacy): unchanged and never mentions department_id", () => {
  const recorder = () =>
    Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = db(strings, ...values);
        seenSql.push(query.text);
        return query;
      },
      { unsafe: (text: string) => db.unsafe(text), transaction: (queries: never) => db.transaction(queries) },
    );

  it("emits no department_id with the policy table present, and returns both departments", async () => {
    const rows = await getPurchaseOrderSuggestions(recorder() as never, all, { mode: "legacy" });
    expect(idsOf(rows)).toEqual([...A_ITEMS, ...B_ITEMS].sort());
    expect(seenSql.some((text) => /reagent_order_policy p/i.test(text))).toBe(true); // policy branch
    expect(seenSql.length).toBeGreaterThanOrEqual(3);
    expect(seenSql.filter((text) => /department_id/i.test(text))).toEqual([]);
  });

  it("emits no department_id without the policy table either", async () => {
    await db.db.exec("ALTER TABLE reagent_order_policy RENAME TO reagent_order_policy_off");
    try {
      const rows = await getPurchaseOrderSuggestions(recorder() as never, all, { mode: "legacy" });
      expect(idsOf(rows)).toEqual([...A_ITEMS, ...B_ITEMS].sort());
      expect(seenSql.some((text) => /reagent_order_policy p/i.test(text))).toBe(false); // really took the other branch
      expect(seenSql.filter((text) => /department_id/i.test(text))).toEqual([]);
    } finally {
      await db.db.exec("ALTER TABLE reagent_order_policy_off RENAME TO reagent_order_policy");
    }
  });

  it("department scope without the policy table filters too (second branch)", async () => {
    await db.db.exec("ALTER TABLE reagent_order_policy RENAME TO reagent_order_policy_off");
    try {
      const rows = await getPurchaseOrderSuggestions(db as never, all, { mode: "one", departmentId: DEPT_B });
      expect(idsOf(rows)).toEqual(B_ITEMS);
      // Stray inventory stamped department B for an item owned by A must not count for A in this branch either.
      await db.db.exec(`
        INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id)
          VALUES ('LAB-000001', 'STRAY', CURRENT_DATE + 100, 50, '2026-09-01', ${DEPT_B});
      `);
      const a = await getPurchaseOrderSuggestions(db as never, { ...all, itemIds: ["LAB-000001"] }, { mode: "one", departmentId: DEPT_A });
      expect(a).toHaveLength(1);
      expect(Number(a[0].quantity)).toBe(3);
    } finally {
      await db.db.exec("ALTER TABLE reagent_order_policy_off RENAME TO reagent_order_policy");
    }
  });
});
