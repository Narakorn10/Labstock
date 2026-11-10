import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Edge cases of the refill spread read from real count-work-order rows (PGlite, production schema + v30-v34).

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import type { DepartmentScope } from "./scoped-db";
import { DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { COUNT_WORK_ORDER_CHILD_DDL } from "@/test/count-work-order-tables";
import { getRefillInRange } from "./real-usage";

const sql = dbSql as unknown as PgliteSql;
const ONE_B: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const R1 = "MB-000001";

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await sql.db.exec(COUNT_WORK_ORDER_CHILD_DDL);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  await sql.db.exec(`TRUNCATE count_work_order_audit, count_work_order_allocations, count_work_order_items, count_work_orders RESTART IDENTITY CASCADE;`);
});

let orderNo = 0;
async function seedCount(opts: { status?: string; counted: number; target?: number; required?: number; alloc?: number; savedAt?: string; itemId?: string }) {
  orderNo += 1;
  const [order] = (await sql.db.query<{ id: number }>(
    `INSERT INTO count_work_orders (owner_username, job_type, status, department_id) VALUES ($1, '', $2, ${DEPT_B}) RETURNING id`,
    [`edge-owner-${orderNo}`, opts.status ?? "CONFIRMED"],
  )).rows;
  const [item] = (await sql.db.query<{ id: number }>(
    `INSERT INTO count_work_order_items (work_order_id, item_id, name, weekly_target, counted_qty, required_qty) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id`,
    [order.id, opts.itemId ?? R1, opts.target ?? 10, opts.counted, opts.required ?? 0],
  )).rows;
  if (opts.alloc) await sql.db.query(`INSERT INTO count_work_order_allocations (work_order_item_id, inventory_id, qty) VALUES ($1, 1, $2)`, [item.id, opts.alloc]);
  if (opts.savedAt) {
    await sql.db.query(
      `INSERT INTO count_work_order_audit (work_order_id, work_order_item_id, action, actor_username, created_at) VALUES ($1, $2, 'COUNT_SAVED', 'x', $3::timestamptz)`,
      [order.id, item.id, opts.savedAt],
    );
  }
}

const sumOf = (list: Array<{ qty: number }>) => list.reduce((sum, row) => sum + row.qty, 0);
const refillOf = async (start: string, end: string, itemId?: string) => (await getRefillInRange(ONE_B, start, end, itemId)).rows;

describe("getRefillInRange edge cases", () => {
  it("an item that only has one refill in the range still gets its spread (refill-only item)", async () => {
    await seedCount({ counted: 3, alloc: 7, savedAt: "2026-11-10 02:00+00" });
    const found = await refillOf("2026-11-01", "2026-11-30", R1);
    expect(sumOf(found)).toBeCloseTo(7, 2);
    expect(found).toHaveLength(7);
  });

  it("a range of one day returns only that day's share", async () => {
    await seedCount({ counted: 3, alloc: 7, savedAt: "2026-11-10 02:00+00" });
    const found = await refillOf("2026-11-05", "2026-11-05", R1);
    expect(found).toEqual([{ itemId: R1, name: "x", date: "2026-11-05", qty: 1 }]);
  });

  it("a range that cuts the spread in the middle returns only the days inside it (the cut part is not lost for a wider range)", async () => {
    await seedCount({ counted: 3, alloc: 7, savedAt: "2026-11-10 02:00+00" }); // 3-9 Nov, 1/day
    expect(sumOf(await refillOf("2026-11-08", "2026-11-20", R1))).toBeCloseTo(2, 2);
    expect(sumOf(await refillOf("2026-11-01", "2026-11-04", R1))).toBeCloseTo(2, 2);
    expect(sumOf(await refillOf("2026-11-01", "2026-11-20", R1))).toBeCloseTo(7, 2);
  });

  it("a range that ends on the count day itself gets nothing from that count (the refill belongs to the days before)", async () => {
    await seedCount({ counted: 3, alloc: 7, savedAt: "2026-11-10 02:00+00" });
    expect(await refillOf("2026-11-10", "2026-11-12", R1)).toEqual([]);
  });

  it("a range that starts exactly on the first spread day includes it", async () => {
    await seedCount({ counted: 3, alloc: 7, savedAt: "2026-11-10 02:00+00" });
    const found = await refillOf("2026-11-03", "2026-11-03", R1);
    expect(found).toHaveLength(1);
    expect(found[0].qty).toBe(1);
  });

  it("a decimal quantity keeps its total (2.5 over 7 days, cents on the last days)", async () => {
    await seedCount({ counted: 3, alloc: 2.5, savedAt: "2026-11-10 02:00+00" });
    const found = await refillOf("2026-11-01", "2026-11-30", R1);
    expect(sumOf(found)).toBeCloseTo(2.5, 2);
    expect(found).toHaveLength(7);
    // 250 cents / 7 = 35 r 5 -> first two days 0.35, the last five 0.36
    expect(found.map((row) => row.qty)).toEqual([0.35, 0.35, 0.36, 0.36, 0.36, 0.36, 0.36]);
  });

  it("a long gap between two counts (60 days) spreads over all 60 days, one unit each", async () => {
    await seedCount({ counted: 3, alloc: 5, savedAt: "2026-09-10 02:00+00" });
    await seedCount({ counted: 3, alloc: 60, savedAt: "2026-11-09 02:00+00" });
    const found = await refillOf("2026-09-10", "2026-11-08", R1);
    expect(found).toHaveLength(60);
    expect(found[0].date).toBe("2026-09-10");
    expect(found[59].date).toBe("2026-11-08");
    expect(found.every((row) => row.qty === 1)).toBe(true);
  });

  it("weekly_target changing between rounds does not change the total: it is what was really taken", async () => {
    await seedCount({ counted: 4, target: 10, alloc: 6, savedAt: "2026-11-03 02:00+00" });
    await seedCount({ counted: 5, target: 20, alloc: 15, savedAt: "2026-11-10 02:00+00" });
    await seedCount({ counted: 1, target: 3, alloc: 2, savedAt: "2026-11-17 02:00+00" });
    expect(sumOf(await refillOf("2026-10-01", "2026-12-31", R1))).toBeCloseTo(6 + 15 + 2, 2);
  });

  it("an OPEN order still waiting for the stock to be taken (required > 0, no allocation) is neither refill nor boundary", async () => {
    await seedCount({ counted: 3, alloc: 7, savedAt: "2026-11-03 02:00+00" });
    await seedCount({ status: "OPEN", counted: 4, required: 6, savedAt: "2026-11-06 02:00+00" });
    await seedCount({ counted: 6, alloc: 4, savedAt: "2026-11-10 02:00+00" });
    const result = await getRefillInRange(ONE_B, "2026-11-03", "2026-11-09", R1);
    expect(sumOf(result.rows)).toBeCloseTo(4, 2);
    expect(result.rows).toHaveLength(7); // spread back to 3 Nov, not cut at 6 Nov
    expect(result.lastCountDate).toBe("2026-11-10");
  });

  it("an OPEN pending order alone gives no refill and no last count date", async () => {
    await seedCount({ status: "OPEN", counted: 4, required: 6, savedAt: "2026-11-06 02:00+00" });
    await expect(getRefillInRange(ONE_B, "2026-01-01", "2026-12-31")).resolves.toEqual({ rows: [], lastCountDate: null, firstSpreadDate: null });
  });

  it("firstSpreadDate is the earliest day of any spread of the scope, whatever the asked range is", async () => {
    await seedCount({ counted: 3, alloc: 14, savedAt: "2026-10-03 02:00+00" }); // first count: 26 Sep - 2 Oct
    await seedCount({ counted: 3, alloc: 5, savedAt: "2026-10-10 02:00+00" });
    const narrow = await getRefillInRange(ONE_B, "2026-10-05", "2026-10-06");
    expect(narrow.firstSpreadDate).toBe("2026-09-26");
    expect((await getRefillInRange(ONE_B, "2026-01-01", "2026-12-31")).firstSpreadDate).toBe("2026-09-26");
  });

  it("a count saved right after midnight Thai time belongs to that Thai day (spread ends the day before)", async () => {
    // 2026-11-09 17:00Z = 2026-11-10 00:00 in Thailand
    await seedCount({ counted: 3, alloc: 7, savedAt: "2026-11-09 17:00+00" });
    const found = await refillOf("2026-11-01", "2026-11-30", R1);
    expect(found.at(-1)?.date).toBe("2026-11-09");
    expect(found[0].date).toBe("2026-11-03");
    // and one second earlier it is still 9 Nov, so the spread ends on 8 Nov
    await sql.db.exec(`TRUNCATE count_work_order_audit, count_work_order_allocations, count_work_order_items, count_work_orders RESTART IDENTITY CASCADE;`);
    await seedCount({ counted: 3, alloc: 7, savedAt: "2026-11-09 16:59:59+00" });
    expect((await refillOf("2026-11-01", "2026-11-30", R1)).at(-1)?.date).toBe("2026-11-08");
  });

  it("an empty department gives empty rows and null lastCountDate", async () => {
    await expect(getRefillInRange(ONE_B, "2026-01-01", "2026-12-31")).resolves.toEqual({ rows: [], lastCountDate: null, firstSpreadDate: null });
  });
});
