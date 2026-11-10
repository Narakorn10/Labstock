import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEPT_A, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";
import { COUNT_WORK_ORDER_CHILD_DDL } from "@/test/count-work-order-tables";

// End to end through the real /api/usage route: monthly matrix per reagent == summary usage, and the summary table's
// days-until-Min == insights.daysUntilMin. Real in-memory Postgres, production schema + v30-v35.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  user: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({
  getAuthenticatedUser: async () => h.user,
  hasMenuPermission: async () => ({ user: h.user, allowed: Boolean(h.user) }),
}));

import { GET as usageGet } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { buildItemSummaryRows, buildMonthlyMatrix } from "@/lib/analysis-summary";
import type { UsageResponse } from "@/lib/api-client";

let db: PgliteSql;
const DISPENSE = "เบิกไปหน้างาน";
const OWNER = "usage-e2e-test";
const A = "A-000002";
const LAB = "LAB-000001";

const bodyOf = async (response: Response) => (await response.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const get = async (start: string, end: string) => bodyOf(await usageGet(new Request(`http://localhost/api/usage?startDate=${start}&endDate=${end}`)));

beforeAll(async () => {
  db = createPgliteSql();
  await seedTwoDepartments(db);
  await db.db.exec(COUNT_WORK_ORDER_CHILD_DDL);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

async function seedCount(itemId: string, opts: { status?: string; target: number; counted: number; required?: number; alloc?: number; savedAt: string }) {
  await db.db.query(
    `WITH o AS (INSERT INTO count_work_orders (owner_username, job_type, status, department_id) VALUES ($1, '', $2, ${DEPT_A}) RETURNING id),
     i AS (INSERT INTO count_work_order_items (work_order_id, item_id, name, weekly_target, counted_qty, required_qty) SELECT id, $3, 'x', $4, $5, $6 FROM o RETURNING id, work_order_id),
     a AS (INSERT INTO count_work_order_allocations (work_order_item_id, inventory_id, qty) SELECT id, 1, $7 FROM i WHERE $7::numeric > 0)
     INSERT INTO count_work_order_audit (work_order_id, work_order_item_id, action, actor_username, created_at)
     SELECT work_order_id, id, 'COUNT_SAVED', $1, $8::timestamptz FROM i`,
    [OWNER, opts.status ?? "CONFIRMED", itemId, opts.target, opts.counted, opts.required ?? 0, opts.alloc ?? 0, opts.savedAt],
  );
}

beforeEach(async () => {
  h.target = db as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  h.user = { username: "admin1", name: "admin1", role: "Admin", scope: DEPT_A };
  await db.db.exec(`
    TRUNCATE count_work_order_audit, count_work_order_allocations, count_work_order_items, count_work_orders, logs, inventory RESTART IDENTITY CASCADE;
    UPDATE master_data SET min_threshold = 0;
    UPDATE master_data SET min_threshold = 3 WHERE item_id = '${A}';
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('${A}', 'LA1', CURRENT_DATE + 200, 40, '2026-09-01', ${DEPT_A}),
      ('${LAB}', 'LA2', CURRENT_DATE + 200, 5, '2026-09-01', ${DEPT_A});
    INSERT INTO logs (timestamp, item_id, name, lot_no, action, quantity, username, department_id) VALUES
      ('2026-09-10 03:00+00', '${A}', 'x', 'LA1', '${DISPENSE}', 2, 'u', ${DEPT_A}),
      ('2026-10-05 03:00+00', '${A}', 'x', 'LA1', '${DISPENSE}', 3, 'u', ${DEPT_A}),
      ('2026-10-31 18:00+00', '${A}', 'x', 'LA1', '${DISPENSE}', 4, 'u', ${DEPT_A}),
      (NOW() - INTERVAL '1 day', '${A}', 'x', 'LA1', '${DISPENSE}', 5, 'u', ${DEPT_A});
  `);
  // weekly_target changes every round (10 -> 20 -> 5): the total must stay what was really taken.
  await seedCount(A, { target: 10, counted: 4, alloc: 6.55, savedAt: "2026-09-20 02:00+00" }); // spread 13-19 Sep
  await seedCount(A, { target: 20, counted: 6, alloc: 14, savedAt: "2026-10-03 02:00+00" }); // 20 Sep - 2 Oct (13 days)
  await seedCount(A, { target: 5, counted: 2, alloc: 31, savedAt: "2026-11-02 02:00+00" }); // 3 Oct - 1 Nov (30 days)
  await seedCount(A, { status: "OPEN", target: 10, counted: 4, required: 6, savedAt: "2026-10-20 02:00+00" }); // waiting for the stock: ignored
  await seedCount(LAB, { target: 10, counted: 1, alloc: 2.5, savedAt: "2026-10-15 02:00+00" }); // refill-only reagent
});

describe("GET /api/usage -> buildMonthlyMatrix / buildItemSummaryRows", () => {
  it("the months of every reagent add up to summary[X].usage, from the first log to today (future end clamped)", async () => {
    const first = (await get("2020-01-01", "2099-12-31")).firstLogDate as string;
    expect(first).toBe("2026-09-10");
    const body = await get(first, "2099-12-31"); // start = firstLogDate: its first day is included
    const a = body.summary.find((row: { itemId: string }) => row.itemId === A);
    expect(a.dispensed).toBe(14);
    expect(a.refill).toBeCloseTo(6.55 + 14 + 31, 2);
    expect(a.usage).toBeCloseTo(14 + 51.55, 2);

    const { rows } = buildMonthlyMatrix(body.dailyStats, body.range);
    for (const entry of body.summary as Array<{ itemId: string; usage: number; refill: number; dispensed: number }>) {
      const row = rows.find((r) => r.itemId.toLowerCase() === entry.itemId.toLowerCase());
      expect(row, entry.itemId).toBeDefined();
      const monthSum = Object.values(row!.months).reduce((sum, cell) => sum + cell.total, 0);
      expect(monthSum, entry.itemId).toBeCloseTo(entry.usage, 2);
      expect(row!.total.total, entry.itemId).toBeCloseTo(entry.usage, 2);
      expect(row!.total.refill, entry.itemId).toBeCloseTo(entry.refill, 2);
      expect(row!.total.regular, entry.itemId).toBeCloseTo(entry.dispensed, 2);
    }
    expect(rows).toHaveLength(body.summary.length);
    expect(body.dailyStats.every((day: { date: string }) => day.date <= body.range.endDate)).toBe(true);
  });

  it("a range that cuts the spreads mid-way still balances month by month (October only)", async () => {
    const body = await get("2026-10-01", "2026-10-31");
    const a = body.summary.find((row: { itemId: string }) => row.itemId === A);
    // 1-2 Oct: last 2 days of the 13-day spread of 14 (1.08 each); 3-31 Oct: 20 days of 1.03 + 9 days of 1.04 from the 31
    expect(a.dispensed).toBe(3); // the 18:00Z log on 31 Oct is already 1 Nov in Thailand
    expect(a.refill).toBeCloseTo(2.16 + 20.6 + 9.36, 2);
    const { rows } = buildMonthlyMatrix(body.dailyStats, body.range);
    const row = rows.find((r) => r.itemId === A)!;
    expect(Object.keys(row.months)).toEqual(["2026-10"]);
    expect(row.months["2026-10"].total).toBeCloseTo(a.usage, 2);
    expect(rows.reduce((sum, r) => sum + r.total.total, 0)).toBeCloseTo(body.summary.reduce((sum: number, r: { usage: number }) => sum + r.usage, 0), 2);
  });

  it("a one day range carries that day's dispensed and refill share", async () => {
    const body = await get("2026-10-05", "2026-10-05");
    expect(body.range.days).toBe(1);
    const a = body.summary.find((row: { itemId: string }) => row.itemId === A);
    expect(a).toMatchObject({ dispensed: 3 });
    expect(a.refill).toBeCloseTo(1.03, 2);
    expect(a.usage).toBeCloseTo(4.03, 2);
    expect(buildMonthlyMatrix(body.dailyStats, body.range).rows.find((r) => r.itemId === A)!.total.total).toBeCloseTo(4.03, 2);
  });

  it("the open order that is still waiting for the stock changes nothing (the 3 Oct - 1 Nov spread stays 30 days)", async () => {
    const body = await get("2026-10-10", "2026-10-10");
    const a = body.summary.find((row: { itemId: string }) => row.itemId === A);
    expect(a.refill).toBeCloseTo(1.03, 2); // 3100 cents / 30 days = 103 cents, day 10 Oct is in the first 20 days
  });

  it("firstLogDate also reaches back to the 7 day spread of the first count, so 'all' keeps every refilled unit", async () => {
    // first log 1 Oct, first count 3 Oct with a refill of 14: it spreads over 26 Sep - 2 Oct (2 a day), before the first log
    await db.db.exec(`
      TRUNCATE count_work_order_audit, count_work_order_allocations, count_work_order_items, count_work_orders, logs RESTART IDENTITY CASCADE;
      INSERT INTO logs (timestamp, item_id, name, lot_no, action, quantity, username, department_id)
      VALUES ('2026-10-01 03:00+00', '${A}', 'x', 'LA1', '${DISPENSE}', 1, 'u', ${DEPT_A});
    `);
    await seedCount(A, { target: 10, counted: 4, alloc: 14, savedAt: "2026-10-03 02:00+00" });

    const first = (await get("2020-01-01", "2099-12-31")).firstLogDate as string;
    expect(first).toBe("2026-09-26");
    const body = await get(first, "2099-12-31");
    const a = body.summary.find((row: { itemId: string }) => row.itemId === A);
    expect(a.refill).toBeCloseTo(14, 2);
    expect(a.dispensed).toBe(1);
  });

  it("sends the latest count day of each reagent, only to Admin/Manager, and the summary average stops the day before it", async () => {
    const body = await get("2026-09-10", "2026-11-10");
    // the OPEN order waiting for the stock (20 Oct) is not a count; the latest counts are 2 Nov (A) and 15 Oct (LAB)
    expect(body.lastCountByItem).toEqual({ [A]: "2026-11-02", [LAB]: "2026-10-15" });

    const response = body as UsageResponse;
    const rows = buildItemSummaryRows(response.insights ?? [], response.summary, response.range!.days, {
      dailyStats: response.dailyStats ?? [],
      lastCountByItem: response.lastCountByItem ?? {},
      range: response.range!,
    });
    const a = rows.find((row) => row.itemId === A)!;
    expect(a.averageDays).toBe(53); // 10 Sep - 1 Nov
    // 14 dispensed up to 1 Nov, minus the log of 1 Nov Thai time? it is 4 (18:00Z on 31 Oct): all inside; refill 6.55 + 14 + 31
    expect(a.averagePerDay).toBeCloseTo((2 + 3 + 4 + 6.55 + 14 + 31) / 53, 2);
    const lab = rows.find((row) => row.itemId === LAB)!;
    expect(lab.averageDays).toBe(35); // 10 Sep - 14 Oct
    expect(lab.averagePerDay).toBeCloseTo(2.5 / 35, 2);

    h.user = { username: "user1", name: "user1", role: "User", scope: DEPT_A };
    const plain = await get("2026-09-10", "2026-11-10");
    expect(Object.keys(plain)).toEqual(["summary"]);
  });

  it("firstLogDate stays the oldest log when no spread reaches further back", async () => {
    expect((await get("2020-01-01", "2099-12-31")).firstLogDate).toBe("2026-09-10");
  });

  it("still answers 200 with the purchase plan when the refill query fails, and says the refill is unavailable", async () => {
    const real = db as unknown as Impl & { unsafe: unknown; transaction: unknown };
    const failing = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) =>
        strings.join("?").includes("count_work_orders") ? Promise.reject(new Error("count tables down")) : real(strings, ...values),
      { unsafe: real.unsafe, transaction: real.transaction },
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.target = failing as unknown as Impl;
    try {
      const body = await get("2026-09-01", "2099-12-31");
      expect(body.refillUnavailable).toBe(true);
      expect(body.insights.length).toBeGreaterThan(0);
      expect(body.expiryRisks).toBeDefined();
      expect(body.dailyStats.every((day: { totalRefill: number }) => day.totalRefill === 0)).toBe(true);
      expect(body.lastCountDate).toBeNull();
      expect(body.lastCountByItem).toEqual({});
      expect(errors.mock.calls.some((call) => /refill/i.test(String(call[0])))).toBe(true);
    } finally {
      h.target = real as unknown as Impl;
      errors.mockRestore();
    }
    // back to normal: the field is not there
    expect((await get("2026-09-01", "2099-12-31")).refillUnavailable).toBeFalsy();
  });

  it("a failure of another query is not swallowed (still 500)", async () => {
    const real = db as unknown as Impl & { unsafe: unknown; transaction: unknown };
    const failing = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) =>
        strings.join("?").includes("MIN(timestamp)") ? Promise.reject(new Error("logs down")) : real(strings, ...values),
      { unsafe: real.unsafe, transaction: real.transaction },
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.target = failing as unknown as Impl;
    try {
      const response = await usageGet(new Request("http://localhost/api/usage?startDate=2026-09-01&endDate=2099-12-31"));
      expect(response.status).toBe(500);
    } finally {
      h.target = real as unknown as Impl;
      errors.mockRestore();
    }
  });

  it("the summary table days-until-Min is exactly insights.daysUntilMin of the same response", async () => {
    const body = await get("2026-09-01", "2099-12-31");
    const table = buildItemSummaryRows(body.insights, body.summary, body.range.days);
    expect(body.insights.length).toBeGreaterThan(0);
    for (const insight of body.insights as Array<{ itemId: string; daysUntilMin: number | null }>) {
      const row = table.find((r) => r.itemId.toLowerCase() === insight.itemId.toLowerCase());
      expect(row, insight.itemId).toBeDefined();
      expect(row!.daysUntilMin, insight.itemId).toBe(insight.daysUntilMin);
    }
    // the reagent that was dispensed in the last 90 days has a real number, not null
    const a = body.insights.find((row: { itemId: string }) => row.itemId === A);
    expect(a.daysUntilMin).not.toBeNull();
    expect(table.find((r) => r.itemId === A)!.daysUntilMin).toBe(a.daysUntilMin);
    // and it does not move when the analysed range changes
    const other = await get("2026-10-01", "2026-10-31");
    expect(other.insights.find((row: { itemId: string }) => row.itemId === A).daysUntilMin).toBe(a.daysUntilMin);
  });
});
