import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Real usage (count-work-order refills) against the production schema + v30-v34 (PGlite), using the real save / confirm / cancel code.

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import type { DepartmentScope } from "./scoped-db";
import { DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { COUNT_WORK_ORDER_CHILD_DDL } from "@/test/count-work-order-tables";
import { cancelCountWorkOrder, confirmCountWorkOrder, saveCountWorkOrder } from "./count-work-orders";
import { bangkokToday } from "./bangkok-date";
import { getRefillInRange } from "./real-usage";

const sql = dbSql as unknown as PgliteSql;
const ONE_B: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const audit = { userAgent: "test", ipAddress: "127.0.0.1" };
const owner = { username: "ownery", name: "Owner Y", role: "User" };
const REFILL_LOG = "เบิกเติมจากใบงานนับสต็อก";
const R1 = "MB-000001";
const R2 = "MB-000002";

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;
const sumOf = (list: Array<{ qty: number }>) => list.reduce((sum, row) => sum + row.qty, 0);

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await sql.db.exec(COUNT_WORK_ORDER_CHILD_DDL);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

// Department B owns MB-000001 and MB-000002 (weekly target 10). Lots: MB-000001 -> inventory id 1, MB-000002 -> id 2.
beforeEach(async () => {
  await sql.db.exec(`
    TRUNCATE count_work_order_audit, count_work_order_allocations, count_work_order_items, count_work_orders, logs, inventory RESTART IDENTITY CASCADE;
    UPDATE master_data SET is_active = TRUE;
    UPDATE master_data SET weekly_target = 10, job_type = 'Routine' WHERE item_id IN ('${R1}', '${R2}');
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('${R1}', 'LB1', '2027-01-01', 100, '2026-09-01', ${DEPT_B}),
      ('${R2}', 'LB2', '2027-01-01', 100, '2026-09-01', ${DEPT_B});
  `);
});

// A count that is written straight into the tables, saved at a fixed time (the audit row decides the count date).
let orderNo = 0;
async function seedCount(opts: { status: string; itemId: string; counted: number; alloc?: number; savedAt?: string }) {
  orderNo += 1;
  const [order] = (await sql.db.query<{ id: number }>(
    `INSERT INTO count_work_orders (owner_username, job_type, status, department_id) VALUES ($1, '', $2, ${DEPT_B}) RETURNING id`,
    [`seed-owner-${orderNo}`, opts.status],
  )).rows;
  const [item] = (await sql.db.query<{ id: number }>(
    `INSERT INTO count_work_order_items (work_order_id, item_id, name, weekly_target, counted_qty, required_qty) VALUES ($1, $2, 'x', 10, $3, 0) RETURNING id`,
    [order.id, opts.itemId, opts.counted],
  )).rows;
  if (opts.alloc) await sql.db.query(`INSERT INTO count_work_order_allocations (work_order_item_id, inventory_id, qty) VALUES ($1, 1, $2)`, [item.id, opts.alloc]);
  if (opts.savedAt) {
    await sql.db.query(
      `INSERT INTO count_work_order_audit (work_order_id, work_order_item_id, action, actor_username, created_at) VALUES ($1, $2, 'COUNT_SAVED', 'x', $3::timestamptz)`,
      [order.id, item.id, opts.savedAt],
    );
  }
}

const refillOf = async (start: string, end: string, itemId?: string) => (await getRefillInRange(ONE_B, start, end, itemId)).rows;

describe("getRefillInRange on real work orders", () => {
  it("save + confirm: the refill equals the refill logs and lands in the 7 days before today", async () => {
    const saved = await saveCountWorkOrder(owner, "Routine", [{ itemId: R1, countedQty: 4 }], ONE_B);
    await confirmCountWorkOrder(owner, saved.id, [{ itemId: R1, inventoryId: 1, qty: 6 }], audit, ONE_B);

    const today = bangkokToday();
    const found = await refillOf(addDays(today, -7), today, R1);
    const logged = Number((await rows<{ total: string }>(`SELECT SUM(quantity) AS total FROM logs WHERE action = '${REFILL_LOG}'`))[0].total);
    expect(logged).toBe(6);
    expect(sumOf(found)).toBeCloseTo(logged, 2);
    expect(found.map((row) => row.date)).toEqual(Array.from({ length: 7 }, (_, index) => addDays(today, index - 7)));
    expect(found.every((row) => row.itemId === R1)).toBe(true);
  });

  it("save two items, confirm one, cancel the order: only the confirmed item counts, equal to the refill logs", async () => {
    const saved = await saveCountWorkOrder(owner, "Routine", [{ itemId: R1, countedQty: 4 }, { itemId: R2, countedQty: 3 }], ONE_B);
    await confirmCountWorkOrder(owner, saved.id, [{ itemId: R1, inventoryId: 1, qty: 6 }], audit, ONE_B);
    await cancelCountWorkOrder(owner, saved.id, ONE_B);

    expect((await rows<{ status: string }>("SELECT status FROM count_work_orders"))[0].status).toBe("CANCELLED");
    const today = bangkokToday();
    const r1 = await refillOf(addDays(today, -7), today, R1);
    const r2 = await refillOf(addDays(today, -7), today, R2);
    const logged = Number((await rows<{ total: string }>(`SELECT SUM(quantity) AS total FROM logs WHERE action = '${REFILL_LOG}'`))[0].total);
    const allocated = Number((await rows<{ total: string }>("SELECT SUM(qty) AS total FROM count_work_order_allocations"))[0].total);
    expect(allocated).toBe(6);
    expect(logged).toBe(6);
    expect(sumOf(r1)).toBeCloseTo(6, 2);
    expect(r2).toEqual([]);
    expect((await refillOf(addDays(today, -7), today)).map((row) => row.itemId)).toEqual(Array.from({ length: 7 }, () => R1));
  });

  it("a cancelled order with no allocation (counted at or above the target) is neither a refill nor a boundary", async () => {
    await seedCount({ status: "CONFIRMED", itemId: R1, counted: 3, alloc: 7, savedAt: "2026-11-03 02:00+00" });
    await seedCount({ status: "CANCELLED", itemId: R1, counted: 12, savedAt: "2026-11-06 02:00+00" });
    await seedCount({ status: "CONFIRMED", itemId: R1, counted: 3, alloc: 4, savedAt: "2026-11-10 02:00+00" });

    const found = await refillOf("2026-11-03", "2026-11-09", R1);
    expect(found.map((row) => row.date)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
    expect(sumOf(found)).toBeCloseTo(4, 2);
  });

  it.each(["OPEN", "CONFIRMED"])("a %s count that needed no refill is a boundary and adds nothing", async (status) => {
    await seedCount({ status: "CONFIRMED", itemId: R1, counted: 3, alloc: 7, savedAt: "2026-11-03 02:00+00" });
    await seedCount({ status, itemId: R1, counted: 12, savedAt: "2026-11-06 02:00+00" });
    await seedCount({ status: "CONFIRMED", itemId: R1, counted: 6, alloc: 4, savedAt: "2026-11-10 02:00+00" });

    const found = await refillOf("2026-11-03", "2026-11-09", R1);
    expect(found.map((row) => row.date)).toEqual(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
    expect(sumOf(found)).toBeCloseTo(4, 2);
  });

  it("an OPEN count that still needs a refill (nothing taken yet) is not an event", async () => {
    await seedCount({ status: "CONFIRMED", itemId: R1, counted: 3, alloc: 7, savedAt: "2026-11-03 02:00+00" });
    await seedCount({ status: "OPEN", itemId: R1, counted: 4, savedAt: "2026-11-06 02:00+00" });
    await seedCount({ status: "CONFIRMED", itemId: R1, counted: 6, alloc: 4, savedAt: "2026-11-10 02:00+00" });
    // counted 4 < target 10 and no allocation: pending, so the 4 units spread back to 3 Nov, not 6 Nov
    const found = await refillOf("2026-11-03", "2026-11-09", R1);
    expect(found).toHaveLength(7);
  });

  it("a count with no date at all (no audit row, no allocation) is skipped without error", async () => {
    await seedCount({ status: "OPEN", itemId: R2, counted: 12 });
    await expect(getRefillInRange(ONE_B, "2026-11-01", "2026-11-30")).resolves.toMatchObject({ rows: [], lastCountDate: null });
  });
});
