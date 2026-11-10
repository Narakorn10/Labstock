import type { DailyStat, ReagentUsageInsight, UsageData } from "@/lib/api-client";

// Pure helpers for the Analysis "สรุปรายน้ำยา" tab. No database here: the page already has the numbers.

export type UsageCell = { regular: number; refill: number; total: number };
export type MonthColumn = { month: string; daysInRange: number; daysInMonth: number; partial: boolean };
export type MonthlyRow = { itemId: string; months: Record<string, UsageCell>; total: UsageCell };
export type MonthlyMatrix = { months: MonthColumn[]; rows: MonthlyRow[] };

const round2 = (value: number) => Math.round(value * 100) / 100;
const emptyCell = (): UsageCell => ({ regular: 0, refill: 0, total: 0 });

function addToCell(cell: UsageCell, regular: number, refill: number) {
  cell.regular = round2(cell.regular + regular);
  cell.refill = round2(cell.refill + refill);
  cell.total = round2(cell.regular + cell.refill);
}

const daysInMonthOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function monthColumns(monthKeys: string[], range?: { startDate: string; endDate: string }): MonthColumn[] {
  return monthKeys.map((month) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const daysInMonth = daysInMonthOf(year, monthNumber);
    if (!range) return { month, daysInRange: daysInMonth, daysInMonth, partial: false };
    const first = `${month}-01`;
    const last = `${month}-${String(daysInMonth).padStart(2, "0")}`;
    const from = range.startDate > first ? range.startDate : first;
    const to = range.endDate < last ? range.endDate : last;
    const daysInRange = Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
    return { month, daysInRange, daysInMonth, partial: daysInRange < daysInMonth };
  });
}

const MAX_MONTH_COLUMNS = 600; // 50 years: more than any real range, stops a mistyped year from building thousands of columns

/** Every month from the first to the last one, in order (at most the last MAX_MONTH_COLUMNS). */
function monthKeysBetween(first: string, last: string) {
  const [firstYear, firstMonth] = first.split("-").map(Number);
  const [lastYear, lastMonth] = last.split("-").map(Number);
  if (![firstYear, firstMonth, lastYear, lastMonth].every(Number.isFinite)) return [];
  const startIndex = Math.max(firstYear * 12 + (firstMonth - 1), lastYear * 12 + (lastMonth - 1) - (MAX_MONTH_COLUMNS - 1));
  const endIndex = lastYear * 12 + (lastMonth - 1);
  const keys: string[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    keys.push(`${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * Real usage per reagent per month: dispensed to the bench (items) + count refill (itemsRefill) of dailyStats.
 * Ids are merged by lower-case; the first spelling seen is shown.
 */
export function buildMonthlyMatrix(dailyStats: DailyStat[], range?: { startDate: string; endDate: string }): MonthlyMatrix {
  const rowsByKey = new Map<string, MonthlyRow>();
  const rowOf = (itemId: string) => {
    const key = itemId.toLowerCase();
    let row = rowsByKey.get(key);
    if (!row) {
      row = { itemId, months: {}, total: emptyCell() };
      rowsByKey.set(key, row);
    }
    return row;
  };
  const dataMonths = new Set<string>();
  for (const stat of dailyStats) {
    const month = stat.date.slice(0, 7);
    dataMonths.add(month);
    const add = (itemId: string, regular: number, refill: number) => {
      const row = rowOf(itemId);
      addToCell((row.months[month] ??= emptyCell()), regular, refill);
      addToCell(row.total, regular, refill);
    };
    for (const [itemId, qty] of Object.entries(stat.items)) add(itemId, qty, 0);
    for (const [itemId, qty] of Object.entries(stat.itemsRefill ?? {})) add(itemId, 0, qty);
  }

  const monthKeys = range
    ? monthKeysBetween(range.startDate.slice(0, 7), range.endDate.slice(0, 7))
    : [...dataMonths].sort();
  const rows = [...rowsByKey.values()].sort((left, right) => right.total.total - left.total.total || left.itemId.localeCompare(right.itemId));
  return { months: monthColumns(monthKeys, range), rows };
}

export type ItemSummaryRow = {
  itemId: string;
  name: string;
  unit: string;
  dispensed: number;
  refill: number;
  usage: number;
  averagePerDay: number;
  averagePerWeek: number;
  /** Purchase plan values (insights); null when the item is not in the plan */
  quantity: number | null;
  minThreshold: number | null;
  daysUntilMin: number | null;
};

/**
 * One row per reagent: real usage of the selected days next to the purchase plan values.
 * daysUntilMin is copied from insights as is (same number as the purchase plan), never recomputed.
 */
export function buildItemSummaryRows(insights: ReagentUsageInsight[], summary: UsageData[], days: number): ItemSummaryRow[] {
  const divisor = Math.max(1, days);
  const insightByKey = new Map(insights.map((item) => [item.itemId.toLowerCase(), item]));
  const usageByKey = new Map(summary.map((row) => [row.itemId.toLowerCase(), row]));
  const keys = new Set([...insightByKey.keys(), ...usageByKey.keys()]);

  const rows: ItemSummaryRow[] = [];
  for (const key of keys) {
    const insight = insightByKey.get(key);
    const used = usageByKey.get(key);
    const dispensed = used?.dispensed ?? 0;
    const refill = used?.refill ?? 0;
    const usage = used?.usage ?? round2(dispensed + refill);
    rows.push({
      itemId: insight?.itemId ?? used!.itemId,
      name: insight?.name ?? used!.name,
      unit: insight?.unit ?? "",
      dispensed,
      refill,
      usage,
      averagePerDay: usage / divisor,
      averagePerWeek: (usage / divisor) * 7,
      quantity: insight ? insight.quantity : null,
      minThreshold: insight ? insight.minThreshold : null,
      daysUntilMin: insight ? insight.daysUntilMin : null,
    });
  }
  return rows.sort((left, right) => right.usage - left.usage || left.name.localeCompare(right.name));
}
