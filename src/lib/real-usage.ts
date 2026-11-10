import sql from "@/lib/db";
import { andDept, type DepartmentScope } from "@/lib/scoped-db";

// "Real usage" of a reagent = what left the bench store for the bench (action "เบิกไปหน้างาน") + what the count work
// orders refilled. A refill taken at a count is the usage of the period BEFORE that count, so it is spread evenly over
// the days from the previous count of the same item (inclusive) to the day before this count. The first count of an
// item has no previous count and spreads over the 7 days before it.
//
// A refill is read from count_work_order_allocations (the stock really taken, same transaction and same qty as the
// refill log), so an item that was refilled counts even when its work order was cancelled afterwards.

export const REFILL_ACTION = "เบิกเติมจากใบงานนับสต็อก";
export const FIRST_COUNT_SPREAD_DAYS = 7;

export type CountEvent = {
  itemId: string;
  name: string;
  /** Thai calendar day of the count, YYYY-MM-DD */
  date: string;
  /** units taken at this count (0 for a "zero" boundary) */
  qty: number;
  /** refill: stock was taken; zero: the count needed no refill (still marks the end of a period) */
  kind: "refill" | "zero";
};

export type SpreadItem = { itemId: string; name: string; days: Map<string, number> };
export type RefillRow = { itemId: string; name: string; date: string; qty: number };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Pure. Spreads every refill over its period. Quantities are kept in hundredths (cents) so the days of one event add up
 * exactly; the leftover cents go to the last days of the period (the days nearest the count). The map key is the
 * lower-cased item id; days maps a Thai date to cents.
 */
export function spreadRefillEvents(events: CountEvent[]): Map<string, SpreadItem> {
  const byItem = new Map<string, CountEvent[]>();
  for (const event of events) {
    if (!event.date || !DATE_PATTERN.test(event.date)) continue; // no usable count date: skip
    const key = String(event.itemId).toLowerCase();
    const list = byItem.get(key);
    if (list) list.push(event);
    else byItem.set(key, [event]);
  }

  const result = new Map<string, SpreadItem>();
  for (const [key, list] of byItem) {
    // counts of the same item on the same day are one count
    const perDay = new Map<string, number>();
    for (const event of list) perDay.set(event.date, (perDay.get(event.date) ?? 0) + Math.round(Number(event.qty) * 100));
    const dates = [...perDay.keys()].sort();
    const latest = list.reduce((a, b) => (b.date >= a.date ? b : a));
    const item: SpreadItem = { itemId: latest.itemId, name: latest.name, days: new Map() };

    dates.forEach((date, index) => {
      const cents = perDay.get(date) ?? 0;
      if (cents <= 0) return; // a boundary only
      const start = index > 0 ? dates[index - 1] : addDays(date, -FIRST_COUNT_SPREAD_DAYS);
      const length = daysBetween(start, date);
      const base = Math.floor(cents / length);
      const extra = cents - base * length;
      for (let offset = 0; offset < length; offset += 1) {
        const day = addDays(start, offset);
        const share = base + (offset >= length - extra ? 1 : 0);
        if (share === 0) continue; // a refill smaller than its number of days leaves the early days empty
        item.days.set(day, (item.days.get(day) ?? 0) + share);
      }
    });
    result.set(key, item);
  }
  return result;
}

type EventRow = { itemId: string; name: string | null; date: string | null; qty: string | number; allocations: string | number };

/** Every count event of the department (or of one reagent). Not limited by date: an event after the range still spreads back into it. */
export async function loadCountEvents(scope: DepartmentScope, itemId?: string): Promise<CountEvent[]> {
  const itemFilter = itemId ? sql` AND LOWER(i.item_id) = LOWER(${itemId})` : sql``;
  const rows = await sql`
    SELECT
      COALESCE((SELECT m.item_id FROM master_data m WHERE LOWER(m.item_id) = LOWER(i.item_id)${andDept(scope, "m")} ORDER BY m.item_id LIMIT 1), i.item_id) AS "itemId",
      i.name,
      TO_CHAR(
        COALESCE(
          (SELECT MAX(au.created_at) FROM count_work_order_audit au WHERE au.work_order_item_id = i.id AND au.action = 'COUNT_SAVED'),
          MIN(a.created_at)
        ) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'
      ) AS date,
      COALESCE(SUM(a.qty), 0) AS qty,
      COUNT(a.id) AS allocations
    FROM count_work_order_items i
    JOIN count_work_orders w ON w.id = i.work_order_id
    LEFT JOIN count_work_order_allocations a ON a.work_order_item_id = i.id
    WHERE TRUE${andDept(scope, "w")}${itemFilter}
    GROUP BY i.id, w.id, i.item_id, i.name, i.weekly_target, i.counted_qty, i.work_order_id, w.status
    HAVING COUNT(a.id) > 0
      OR (
        GREATEST(i.weekly_target - i.counted_qty, 0) = 0
        AND (
          w.status <> 'CANCELLED'
          OR EXISTS (
            SELECT 1 FROM count_work_order_allocations x JOIN count_work_order_items xi ON xi.id = x.work_order_item_id
            WHERE xi.work_order_id = i.work_order_id
          )
        )
      )
  `;
  return (rows as unknown as EventRow[]).map((row) => ({
    itemId: row.itemId,
    name: row.name || row.itemId,
    date: row.date as string,
    qty: Number(row.qty) || 0,
    kind: Number(row.allocations) > 0 ? "refill" : "zero",
  }));
}

/**
 * Refill per item and Thai day inside [startDate, endDate] (the part of each spread that falls in the range), plus the
 * latest count day of the scope and firstSpreadDate: the earliest day of any spread of the scope (not limited by the range).
 */
export async function getRefillInRange(scope: DepartmentScope, startDate: string, endDate: string, itemId?: string) {
  const events = await loadCountEvents(scope, itemId);
  const spread = spreadRefillEvents(events);
  const rows: RefillRow[] = [];
  let firstSpreadDate: string | null = null;
  for (const item of spread.values()) {
    for (const [date, cents] of item.days) {
      if (!firstSpreadDate || date < firstSpreadDate) firstSpreadDate = date;
      if (date < startDate || date > endDate) continue;
      rows.push({ itemId: item.itemId, name: item.name, date, qty: cents / 100 });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.itemId.localeCompare(b.itemId)));
  const lastCountDate = events.reduce<string | null>((latest, event) => (event.date && DATE_PATTERN.test(event.date) && (!latest || event.date > latest) ? event.date : latest), null);
  // Latest count day of every item (any date, not cut by the range): its real usage is known only up to the day before.
  const lastCountByItem: Record<string, string> = {};
  for (const event of events) {
    if (!event.date || !DATE_PATTERN.test(event.date)) continue;
    const key = spread.get(String(event.itemId).toLowerCase())?.itemId ?? event.itemId;
    if (!lastCountByItem[key] || event.date > lastCountByItem[key]) lastCountByItem[key] = event.date;
  }
  return { rows, lastCountDate, firstSpreadDate, lastCountByItem };
}

/**
 * getRefillInRange that never throws: when the count tables cannot be read it logs the error and returns an empty
 * result with unavailable = true, so the rest of the analysis (purchase plan, dispense numbers) still loads.
 */
export async function getRefillOrUnavailable(scope: DepartmentScope, startDate: string, endDate: string, itemId?: string) {
  try {
    return { ...(await getRefillInRange(scope, startDate, endDate, itemId)), unavailable: false };
  } catch (error) {
    console.error("Refill from count work orders unavailable, showing dispense only:", error);
    return { rows: [] as RefillRow[], lastCountDate: null as string | null, firstSpreadDate: null as string | null, lastCountByItem: {} as Record<string, string>, unavailable: true };
  }
}
