import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder, recordingSql } from "@/test/purchase-order-dept-fixtures";
import type { PgliteSql } from "@/test/pglite-sql";
import type { DepartmentScope } from "@/lib/scoped-db";

// Department (multi-lab) behaviour of the PO write helpers (review / receipt / status) against a real in-memory
// Postgres with the production schema + v30-v35.

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "@/lib/db";
import {
  applyLabReviewDecision,
  assertPurchaseOrderStatusQuery,
  closePurchaseOrder,
  runGuardedPurchaseOrderUpdate,
} from "./purchase-order-review";
import { confirmLabReceipt } from "./purchase-order-receipt";
import { recomputePurchaseOrderStatusQuery } from "./purchase-order-status";

const sql = dbSql as unknown as PgliteSql;

const scopeA: DepartmentScope = { mode: "one", departmentId: DEPT_A };
const scopeB: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const scopeAll: DepartmentScope = { mode: "all" };
const legacy: DepartmentScope = { mode: "legacy" };

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
}, 120_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  await sql.db.exec(`TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;`);
});

const statusOf = async (poId: number) => (await sql.db.query<{ status: string }>(`SELECT status FROM purchase_orders WHERE id = ${poId}`)).rows[0].status;
const itemOf = async (itemRowId: number) =>
  (await sql.db.query<Record<string, unknown>>(`SELECT * FROM purchase_order_items WHERE id = ${itemRowId}`)).rows[0];

// One entry per guarded write. `seed` creates a PO of department B in the status the action needs; `run` performs it with a scope.
type Seeded = { poId: number; itemRowId: number; poNumber: string; status: string };
const OPERATIONS: Array<{
  name: string;
  status: string;
  quantity?: number;
  run: (po: Seeded, scope: DepartmentScope, db?: unknown) => Promise<unknown>;
  succeeded: (result: unknown) => boolean;
  expectedStatusAfter: string;
}> = [
  {
    name: "runGuardedPurchaseOrderUpdate",
    status: "CONFIRMED",
    run: (po, scope, db = sql) => runGuardedPurchaseOrderUpdate(db as never, po.poId, po.status, [
      sql`UPDATE purchase_order_items SET revision_qty = 1 WHERE po_id = ${po.poId}` as never,
      sql`UPDATE purchase_orders SET status = 'REJECTED' WHERE id = ${po.poId}` as never,
    ], scope),
    succeeded: (result) => result !== null,
    expectedStatusAfter: "REJECTED",
  },
  {
    name: "closePurchaseOrder (CANCEL)",
    status: "SUBMITTED",
    run: (po, scope, db = sql) => closePurchaseOrder(db as never, {
      po: { id: po.poId, po_number: po.poNumber, status: po.status }, action: "CANCEL", reason: "no longer needed", scope,
    }),
    succeeded: (result) => (result as { ok: boolean }).ok === true,
    expectedStatusAfter: "CANCELLED",
  },
  {
    name: "applyLabReviewDecision",
    status: "PENDING_LAB_REVIEW",
    run: (po, scope, db = sql) => applyLabReviewDecision(db as never, {
      po: { id: po.poId, status: po.status }, decision: "CONFIRMED", reviewer: "reviewer", scope,
    }),
    succeeded: (result) => result === true,
    expectedStatusAfter: "CONFIRMED",
  },
  {
    name: "confirmLabReceipt",
    status: "CONFIRMED",
    run: (po, scope, db = sql) => confirmLabReceipt(db as never, {
      po: { id: po.poId, po_number: po.poNumber, status: po.status }, poItemIds: [po.itemRowId], scope,
    }),
    succeeded: (result) => (result as { ok: boolean }).ok === true,
    expectedStatusAfter: "RECEIVED",
  },
];

async function seed(operation: (typeof OPERATIONS)[number], departmentId: number, poNumber = "PO-X"): Promise<Seeded> {
  const itemId = departmentId === DEPT_B ? "MB-000001" : "A-000002";
  const { poId, itemRowId } = await insertPurchaseOrder(sql, { poNumber, departmentId, status: operation.status, itemId, quantity: operation.quantity ?? 10 });
  return { poId, itemRowId, poNumber, status: operation.status };
}

describe.each(OPERATIONS)("$name", (operation) => {
  it("does nothing to a purchase order of another department (PO and items unchanged)", async () => {
    const po = await seed(operation, DEPT_B);
    const itemBefore = await itemOf(po.itemRowId);

    const result = await operation.run(po, scopeA);

    expect(operation.succeeded(result)).toBe(false);
    expect(await statusOf(po.poId)).toBe(operation.status);
    expect(await itemOf(po.itemRowId)).toEqual(itemBefore);
  });

  it("works for the purchase order's own department (control: the filter is not blocking everything)", async () => {
    const po = await seed(operation, DEPT_B);
    const result = await operation.run(po, scopeB);
    expect(operation.succeeded(result)).toBe(true);
    expect(await statusOf(po.poId)).toBe(operation.expectedStatusAfter);
  });

  it("legacy scope touches any department and its SQL never mentions department_id", async () => {
    const po = await seed(operation, DEPT_B);
    const seen: string[] = [];
    const result = await operation.run(po, legacy, recordingSql(sql, seen));
    expect(operation.succeeded(result)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((text) => /department_id/i.test(text))).toEqual([]);
  });

  it("mode all throws DEPARTMENT_READ_ONLY before any SQL is issued and changes nothing", async () => {
    const po = await seed(operation, DEPT_B);
    const seen: string[] = [];
    await expect(operation.run(po, scopeAll, recordingSql(sql, seen))).rejects.toMatchObject({ code: "DEPARTMENT_READ_ONLY" });
    expect(seen).toEqual([]);
    expect(await statusOf(po.poId)).toBe(operation.status);
  });
});

describe("shipments guard stays unfiltered by department", () => {
  it("an In Transit shipment stamped with another department still blocks confirmLabReceipt", async () => {
    const { poId, itemRowId } = await insertPurchaseOrder(sql, { poNumber: "PO-GUARD", departmentId: DEPT_A, status: "CONFIRMED", itemId: "A-000002" });
    await sql.db.exec(`
      INSERT INTO shipments (vendor, item_id, lot_no, exp_date, quantity, status, po_number, department_id)
      VALUES ('Vendor A', 'A-000002', 'LG1', '2099-01-01', 10, 'In Transit', 'PO-GUARD', ${DEPT_B});
    `);
    const result = await confirmLabReceipt(sql as never, {
      po: { id: poId, po_number: "PO-GUARD", status: "CONFIRMED" }, poItemIds: [itemRowId], scope: scopeA,
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect((result as { error: string }).error).toMatch(/in-transit/i);
    expect(Number((await itemOf(itemRowId)).accepted_qty)).toBe(0);
  });

  it("an In Transit shipment stamped with another department still blocks closePurchaseOrder", async () => {
    const { poId } = await insertPurchaseOrder(sql, { poNumber: "PO-GUARD", departmentId: DEPT_A, status: "SUBMITTED", itemId: "A-000002" });
    await sql.db.exec(`
      INSERT INTO shipments (vendor, item_id, lot_no, exp_date, quantity, status, po_number, department_id)
      VALUES ('Vendor A', 'A-000002', 'LG1', '2099-01-01', 10, 'In Transit', 'PO-GUARD', ${DEPT_B});
    `);
    const result = await closePurchaseOrder(sql as never, {
      po: { id: poId, po_number: "PO-GUARD", status: "SUBMITTED" }, action: "CANCEL", reason: "x", scope: scopeA,
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(await statusOf(poId)).toBe("SUBMITTED");
  });
});

describe("recomputePurchaseOrderStatusQuery does not filter by department (documented behaviour)", () => {
  it("a shipment stamped department A for a PO of department B still updates the PO status", async () => {
    await insertPurchaseOrder(sql, { poNumber: "PO-MIXED", departmentId: DEPT_B, status: "CONFIRMED", itemId: "MB-000001", quantity: 10 });
    await sql.db.exec(`
      INSERT INTO shipments (vendor, item_id, lot_no, exp_date, quantity, status, po_number, department_id)
      VALUES ('MB Vendor', 'MB-000001', 'LM1', '2099-01-01', 10, 'In Transit', 'PO-MIXED', ${DEPT_A});
    `);
    for (const scope of [scopeA, scopeB]) {
      await sql.db.exec(`UPDATE purchase_orders SET status = 'CONFIRMED' WHERE po_number = 'PO-MIXED'`);
      const rows = await recomputePurchaseOrderStatusQuery(sql as never, "PO-MIXED", scope);
      expect(rows).toMatchObject([{ status: "SHIPPED" }]);
    }
  });
});

describe("a malformed scope throws before any SQL", () => {
  const BAD: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["empty object", {}],
    ["a user object", { username: "admin1", role: "Admin", scope: DEPT_A }],
    ["mode one without departmentId", { mode: "one" }],
    ["mode one with a string id", { mode: "one", departmentId: "1" }],
  ];
  const CALLS: Array<[string, (scope: never, db: never) => unknown]> = [
    ["runGuardedPurchaseOrderUpdate", (scope, db) => runGuardedPurchaseOrderUpdate(db, 1, "CONFIRMED", [], scope)],
    ["closePurchaseOrder", (scope, db) => closePurchaseOrder(db, { po: { id: 1, po_number: "P", status: "SUBMITTED" }, action: "CANCEL", reason: "x", scope })],
    ["applyLabReviewDecision", (scope, db) => applyLabReviewDecision(db, { po: { id: 1, status: "PENDING_LAB_REVIEW" }, decision: "CONFIRMED", reviewer: "r", scope })],
    ["confirmLabReceipt", (scope, db) => confirmLabReceipt(db, { po: { id: 1, po_number: "P", status: "CONFIRMED" }, poItemIds: [1], scope })],
    ["assertPurchaseOrderStatusQuery", (scope, db) => assertPurchaseOrderStatusQuery(db, 1, "CONFIRMED", scope)],
    ["recomputePurchaseOrderStatusQuery", (scope, db) => recomputePurchaseOrderStatusQuery(db, "P", scope)],
  ];

  describe.each(BAD)("%s", (_name, bad) => {
    it.each(CALLS)("%s", async (_callName, call) => {
      const seen: string[] = [];
      const db = recordingSql(sql, seen);
      await expect(Promise.resolve().then(() => call(bad as never, db as never))).rejects.toThrow("requires a DepartmentScope");
      expect(seen).toEqual([]);
    });
  });
});
