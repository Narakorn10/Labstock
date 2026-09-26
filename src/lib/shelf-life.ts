import type sqlClient from "./db";

type Sql = typeof sqlClient;

export const SHELF_LIFE_BELOW_MINIMUM = "SHELF_LIFE_BELOW_MINIMUM";

export type ShelfLifeViolation = { itemId: string; lotNo: string; expDate: string; daysLeft: number; minDays: number };

/** Whole days from `today` (UTC date) to an ISO `YYYY-MM-DD` expiry date. */
export function daysUntilExpiry(expDate: string, today = new Date()) {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const end = Date.parse(`${expDate.slice(0, 10)}T00:00:00Z`);
  return Math.floor((end - start) / 86400000);
}

export function findShelfLifeViolations(
  lots: Array<{ itemId: string; lotNo: string; expDate: string }>,
  rules: Map<string, number>,
  today = new Date(),
): ShelfLifeViolation[] {
  return lots.flatMap((lot) => {
    const minDays = rules.get(lot.itemId.toLowerCase());
    if (minDays === undefined || !lot.expDate) return [];
    const daysLeft = daysUntilExpiry(lot.expDate, today);
    return daysLeft < minDays ? [{ ...lot, daysLeft, minDays }] : [];
  });
}

export function describeShelfLifeViolations(violations: ShelfLifeViolation[]) {
  return violations
    .map((v) => `${v.itemId} lot ${v.lotNo}: expires in ${v.daysLeft} days, minimum is ${v.minDays} days`)
    .join("; ");
}

function isUndefinedColumn(error: unknown) {
  return (error as { code?: string })?.code === "42703";
}

/** Minimum shelf-life rules keyed by lower-case item ID. Empty before upgrade_v26 is applied. */
export async function loadMinShelfLifeRules(sql: Sql, itemIds: string[]) {
  const rules = new Map<string, number>();
  if (!itemIds.length) return rules;
  try {
    const rows = await sql`
      SELECT item_id, min_shelf_life_days
      FROM master_data
      WHERE LOWER(item_id) = ANY(${itemIds.map((id) => id.toLowerCase())}::text[])
        AND min_shelf_life_days IS NOT NULL
    `;
    for (const row of rows) rules.set(String(row.item_id).toLowerCase(), Number(row.min_shelf_life_days));
  } catch (error) {
    if (!isUndefinedColumn(error)) throw error;
  }
  return rules;
}

export async function listMinShelfLifeRules(sql: Sql) {
  const rows = await sql`SELECT item_id, min_shelf_life_days FROM master_data WHERE min_shelf_life_days IS NOT NULL`;
  return Object.fromEntries(rows.map((row) => [String(row.item_id), Number(row.min_shelf_life_days)]));
}

export { isUndefinedColumn as isShelfLifeSchemaMissing };
