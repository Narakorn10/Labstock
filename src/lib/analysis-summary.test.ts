import { describe, expect, it } from "vitest";
import { buildItemSummaryRows, buildMonthlyMatrix } from "./analysis-summary";
import type { DailyStat, ReagentUsageInsight, UsageData } from "./api-client";

const day = (date: string, items: Record<string, number>, itemsRefill: Record<string, number> = {}): DailyStat => ({
  date,
  totalDispensed: Object.values(items).reduce((a, b) => a + b, 0),
  items,
  itemsRefill,
});

const insight = (itemId: string, extra: Partial<ReagentUsageInsight> = {}): ReagentUsageInsight => ({
  itemId, name: `name ${itemId}`, unit: "ขวด", quantity: 10, minThreshold: 4, dispensedLast90Days: 90,
  averageDailyUsage: 1, daysUntilMin: 6, status: "normal", recommendedOrderQty: 0, ...extra,
});

describe("buildMonthlyMatrix", () => {
  const stats = [
    day("2026-09-28", { R1: 2 }, { R1: 1 }),
    day("2026-09-30", { R1: 1, R2: 4 }),
    day("2026-10-02", { r1: 3 }, { R2: 0.5 }),
    day("2026-11-03", { R2: 2 }, { R1: 2.25 }),
  ];
  const range = { startDate: "2026-09-15", endDate: "2026-11-10" };

  it("sums regular, refill and total per item and month, merging ids that differ only by letter case", () => {
    const { rows } = buildMonthlyMatrix(stats, range);
    expect(rows.map((row) => row.itemId).sort()).toEqual(["R1", "R2"]);
    const r1 = rows.find((row) => row.itemId === "R1")!;
    expect(r1.months["2026-09"]).toEqual({ regular: 3, refill: 1, total: 4 });
    expect(r1.months["2026-10"]).toEqual({ regular: 3, refill: 0, total: 3 });
    expect(r1.months["2026-11"]).toEqual({ regular: 0, refill: 2.25, total: 2.25 });
    expect(r1.total).toEqual({ regular: 6, refill: 3.25, total: 9.25 });
  });

  it("the months of an item add up to its total", () => {
    for (const row of buildMonthlyMatrix(stats, range).rows) {
      const sum = Object.values(row.months).reduce((acc, cell) => acc + cell.total, 0);
      expect(sum).toBeCloseTo(row.total.total, 2);
    }
  });

  it("lists every month of the range with how many of its days are inside the range", () => {
    const { months } = buildMonthlyMatrix(stats, range);
    expect(months).toEqual([
      { month: "2026-09", daysInRange: 16, daysInMonth: 30, partial: true },
      { month: "2026-10", daysInRange: 31, daysInMonth: 31, partial: false },
      { month: "2026-11", daysInRange: 10, daysInMonth: 30, partial: true },
    ]);
  });

  it("without a range it uses the months found in the data and counts them as full", () => {
    const { months } = buildMonthlyMatrix([day("2026-02-10", { R1: 1 })]);
    expect(months).toEqual([{ month: "2026-02", daysInRange: 28, daysInMonth: 28, partial: false }]);
  });

  it("zero-pads the year of a month key so it matches the YYYY-MM keys of the data", () => {
    const { months } = buildMonthlyMatrix([], { startDate: "0999-12-01", endDate: "1000-02-28" });
    expect(months.map((column) => column.month)).toEqual(["0999-12", "1000-01", "1000-02"]);
    expect(months.every((column) => Number.isFinite(column.daysInRange) && column.daysInRange > 0)).toBe(true);
  });

  it("never builds an unbounded list of months for an absurd start year", () => {
    const { months } = buildMonthlyMatrix([], { startDate: "0002-08-01", endDate: "2026-11-10" });
    expect(months.length).toBeLessThanOrEqual(600);
    expect(months.every((column) => /^\d{4}-\d{2}$/.test(column.month))).toBe(true);
    expect(months.every((column) => Number.isFinite(column.daysInRange))).toBe(true);
  });
});

describe("buildItemSummaryRows", () => {
  const summary: UsageData[] = [
    { itemId: "R1", name: "สารหนึ่ง", dispensed: 14, adjusted: 0, received: 5, refill: 7, usage: 21 },
    { itemId: "R9", name: "ไม่มีในแผน", dispensed: 3, adjusted: 0, received: 0, refill: 0, usage: 3 },
  ];
  const insights = [insight("R1", { quantity: 12, minThreshold: 5, daysUntilMin: 3.5 }), insight("R2", { daysUntilMin: null })];

  it("computes totals and averages from the real usage of the selected days, and copies stock/Min/days-until-Min from the purchase plan", () => {
    const rows = buildItemSummaryRows(insights, summary, 7);
    const r1 = rows.find((row) => row.itemId === "R1")!;
    expect(r1).toMatchObject({ dispensed: 14, refill: 7, usage: 21, averagePerDay: 3, averagePerWeek: 21, quantity: 12, minThreshold: 5, daysUntilMin: 3.5, unit: "ขวด" });
    expect(r1.name).toBe("name R1");
  });

  it("daysUntilMin is exactly the value of the insight, never recomputed", () => {
    const rows = buildItemSummaryRows(insights, summary, 30);
    for (const row of rows) {
      const found = insights.find((item) => item.itemId.toLowerCase() === row.itemId.toLowerCase());
      expect(row.daysUntilMin).toBe(found ? found.daysUntilMin : null);
    }
  });

  it("keeps items that have no usage (zero) and usage rows that have no insight (empty plan fields)", () => {
    const rows = buildItemSummaryRows(insights, summary, 10);
    expect(rows.find((row) => row.itemId === "R2")).toMatchObject({ usage: 0, averagePerDay: 0, daysUntilMin: null });
    expect(rows.find((row) => row.itemId === "R9")).toMatchObject({ usage: 3, quantity: null, minThreshold: null, daysUntilMin: null });
  });

  it("falls back to dispensed when the account has no refill data and matches ids by letter case", () => {
    const rows = buildItemSummaryRows([insight("R1")], [{ itemId: "r1", name: "x", dispensed: 4, adjusted: 0, received: 0 }], 2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: "R1", dispensed: 4, refill: 0, usage: 4, averagePerDay: 2 });
  });

  it("never divides by less than one day", () => {
    expect(buildItemSummaryRows([], [{ itemId: "R1", name: "x", dispensed: 6, adjusted: 0, received: 0 }], 0)[0].averagePerDay).toBe(6);
  });
});
