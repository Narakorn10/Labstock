import sql from "@/lib/db";
import { andDept, type DepartmentScope } from "@/lib/scoped-db";
import { computeReorderInsight, daysFromToday, type ReorderStatus } from "@/lib/reagent-usage-insights";
import { getRefillOrUnavailable } from "@/lib/real-usage";

const DISPENSE_ACTION = "เบิกไปหน้างาน";
const RECEIVE_ACTION = "รับเข้าสต๊อกหลัก";
const TOP_USERS_LIMIT = 10;

export interface ItemUsageDetail {
  item: {
    itemId: string;
    name: string;
    unit: string;
    quantity: number;
    minThreshold: number;
    isActive: boolean;
  };
  range: { startDate: string; endDate: string; days: number };
  totals: {
    dispensed: number;
    received: number;
    adjusted: number;
    dispenseCount: number;
    averageDailyUsage: number;
    averageWeeklyUsage: number;
    lastDispensedAt: string | null;
    /** refill from count work orders spread over the days it covers (see real-usage.ts), and dispensed + refill */
    refill: number;
    usage: number;
    averageDailyTotal: number;
    averageWeeklyTotal: number;
  };
  reorder: {
    dispensedLast90Days: number;
    averageDailyUsage: number;
    daysUntilMin: number | null;
    status: ReorderStatus;
    recommendedOrderQty: number;
  };
  /** qty is the regular dispense (as before); regular is the same number; total = regular + refill */
  daily: Array<{ date: string; qty: number; regular: number; refill: number; total: number }>;
  monthly: Array<{ month: string; qty: number; regular: number; refill: number; total: number }>;
  /** Thai day of the latest count of this reagent (the refill of days from then on is not known yet), or null */
  lastCountDate: string | null;
  /** Only present (true) when the refill from count work orders could not be read: refill is 0 and usage is the regular dispense only */
  refillUnavailable?: boolean;
  byLot: Array<{ lotNo: string; qty: number }>;
  byUser: Array<{ username: string; qty: number; count: number }>;
  lotsOnHand: Array<{ lotNo: string; expDate: string; receivedOn: string; quantity: number; daysUntilExpiry: number | null }>;
}

type ItemRow = {
  itemId: string;
  name: string;
  unit: string | null;
  minThreshold: string | number | null;
  isActive: boolean | null;
  quantity: string | number;
  dispensedLast90Days: string | number;
};

const num = (value: unknown) => Number(value) || 0;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Regular and refill quantities per key (day or month), keys in ascending order. */
function mergeByKey(regular: Array<{ key: string; qty: number }>, refill: Map<string, number>) {
  const regularByKey = new Map(regular.map((row) => [row.key, row.qty]));
  const keys = [...new Set([...regularByKey.keys(), ...refill.keys()])].sort();
  return keys.map((key) => {
    const regularQty = regularByKey.get(key) ?? 0;
    const refillQty = round2(refill.get(key) ?? 0);
    return { key, qty: regularQty, regular: regularQty, refill: refillQty, total: round2(regularQty + refillQty) };
  });
}

function daysInRange(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

/** Usage detail of one reagent for the Analysis "รายน้ำยา" tab. Returns null when the item does not exist. */
export async function getReagentItemUsage(itemId: string, startDate: string, endDate: string, scope: DepartmentScope): Promise<ItemUsageDetail | null> {
  const itemRows = await sql`
    SELECT
      m.item_id AS "itemId",
      m.name,
      m.unit,
      m.min_threshold AS "minThreshold",
      m.is_active AS "isActive",
      (SELECT COALESCE(SUM(i.quantity), 0) FROM inventory i WHERE i.item_id = m.item_id${andDept(scope, "i")}) AS quantity,
      (
        SELECT COALESCE(SUM(l.quantity), 0) FROM logs l
        WHERE l.item_id = m.item_id
          AND l.action = ${DISPENSE_ACTION}
          AND l.timestamp >= CURRENT_DATE - INTERVAL '90 days'${andDept(scope, "l")}
      ) AS "dispensedLast90Days"
    FROM master_data m
    WHERE m.item_id = ${itemId}${andDept(scope, "m")}
  `;
  const row = (itemRows as unknown as ItemRow[])[0];
  if (!row) return null;

  const [totalRows, dailyRows, monthlyRows, lotRows, userRows, onHandRows, refillResult] = await Promise.all([
    sql`
      SELECT
        SUM(CASE WHEN action = ${DISPENSE_ACTION} THEN quantity ELSE 0 END) AS dispensed,
        SUM(CASE WHEN action = ${RECEIVE_ACTION} THEN quantity ELSE 0 END) AS received,
        SUM(CASE WHEN action LIKE '%ปรับปรุงยอด%' THEN quantity ELSE 0 END) AS adjusted,
        COUNT(*) FILTER (WHERE action = ${DISPENSE_ACTION}) AS "dispenseCount",
        MAX(timestamp) FILTER (WHERE action = ${DISPENSE_ACTION}) AS "lastDispensedAt"
      FROM logs
      WHERE item_id = ${itemId}
        AND timestamp >= (${startDate}::date)::timestamp AT TIME ZONE 'Asia/Bangkok'
        AND timestamp < (${endDate}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'${andDept(scope)}
    `,
    sql`
      SELECT TO_CHAR(timestamp AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS date, SUM(quantity) AS qty
      FROM logs
      WHERE item_id = ${itemId}
        AND action = ${DISPENSE_ACTION}
        AND timestamp >= (${startDate}::date)::timestamp AT TIME ZONE 'Asia/Bangkok'
        AND timestamp < (${endDate}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'${andDept(scope)}
      GROUP BY date
      ORDER BY date ASC
    `,
    sql`
      SELECT TO_CHAR(timestamp AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS month, SUM(quantity) AS qty
      FROM logs
      WHERE item_id = ${itemId}
        AND action = ${DISPENSE_ACTION}
        AND timestamp >= (${startDate}::date)::timestamp AT TIME ZONE 'Asia/Bangkok'
        AND timestamp < (${endDate}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'${andDept(scope)}
      GROUP BY month
      ORDER BY month ASC
    `,
    sql`
      SELECT COALESCE(NULLIF(lot_no, ''), '-') AS "lotNo", SUM(quantity) AS qty
      FROM logs
      WHERE item_id = ${itemId}
        AND action = ${DISPENSE_ACTION}
        AND timestamp >= (${startDate}::date)::timestamp AT TIME ZONE 'Asia/Bangkok'
        AND timestamp < (${endDate}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'${andDept(scope)}
      GROUP BY 1
      ORDER BY qty DESC
    `,
    sql`
      SELECT COALESCE(NULLIF(username, ''), '-') AS username, SUM(quantity) AS qty, COUNT(*) AS count
      FROM logs
      WHERE item_id = ${itemId}
        AND action = ${DISPENSE_ACTION}
        AND timestamp >= (${startDate}::date)::timestamp AT TIME ZONE 'Asia/Bangkok'
        AND timestamp < (${endDate}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'${andDept(scope)}
      GROUP BY 1
      ORDER BY qty DESC
      LIMIT ${TOP_USERS_LIMIT}
    `,
    sql`
      SELECT lot_no AS "lotNo", exp_date::text AS "expDate", received_on::text AS "receivedOn", quantity
      FROM inventory
      WHERE item_id = ${itemId} AND quantity > 0${andDept(scope)}
      ORDER BY NULLIF(exp_date::text, '') ASC NULLS LAST, received_on ASC
    `,
    getRefillOrUnavailable(scope, startDate, endDate, row.itemId)
  ]);

  const refillByDay = new Map<string, number>();
  const refillByMonth = new Map<string, number>();
  let refill = 0;
  for (const r of refillResult.rows) {
    refillByDay.set(r.date, (refillByDay.get(r.date) ?? 0) + r.qty);
    refillByMonth.set(r.date.slice(0, 7), (refillByMonth.get(r.date.slice(0, 7)) ?? 0) + r.qty);
    refill += r.qty;
  }
  refill = round2(refill);

  const totals = (totalRows as Array<Record<string, unknown>>)[0] || {};
  const days = daysInRange(startDate, endDate);
  const dispensed = num(totals.dispensed);
  const usage = round2(dispensed + refill);
  const quantity = num(row.quantity);
  const minThreshold = num(row.minThreshold);
  const { dispensedLast90Days, averageDailyUsage, daysUntilMin, status, recommendedOrderQty } =
    computeReorderInsight(quantity, minThreshold, num(row.dispensedLast90Days));

  return {
    item: {
      itemId: row.itemId,
      name: row.name,
      unit: row.unit || "หน่วย",
      quantity,
      minThreshold,
      isActive: row.isActive !== false
    },
    range: { startDate, endDate, days },
    totals: {
      dispensed,
      received: num(totals.received),
      adjusted: num(totals.adjusted),
      dispenseCount: num(totals.dispenseCount),
      averageDailyUsage: dispensed / days,
      averageWeeklyUsage: (dispensed / days) * 7,
      lastDispensedAt: totals.lastDispensedAt ? new Date(String(totals.lastDispensedAt)).toISOString() : null,
      refill,
      usage,
      averageDailyTotal: usage / days,
      averageWeeklyTotal: (usage / days) * 7
    },
    reorder: { dispensedLast90Days, averageDailyUsage, daysUntilMin, status, recommendedOrderQty },
    daily: mergeByKey((dailyRows as Array<{ date: string; qty: unknown }>).map((r) => ({ key: r.date, qty: num(r.qty) })), refillByDay)
      .map(({ key, ...rest }) => ({ date: key, ...rest })),
    monthly: mergeByKey((monthlyRows as Array<{ month: string; qty: unknown }>).map((r) => ({ key: r.month, qty: num(r.qty) })), refillByMonth)
      .map(({ key, ...rest }) => ({ month: key, ...rest })),
    lastCountDate: refillResult.lastCountDate,
    ...(refillResult.unavailable ? { refillUnavailable: true } : {}),
    byLot: (lotRows as Array<{ lotNo: string; qty: unknown }>).map((r) => ({ lotNo: r.lotNo, qty: num(r.qty) })),
    byUser: (userRows as Array<{ username: string; qty: unknown; count: unknown }>).map((r) => ({
      username: r.username,
      qty: num(r.qty),
      count: num(r.count)
    })),
    lotsOnHand: (onHandRows as Array<{ lotNo: string; expDate: string | null; receivedOn: string | null; quantity: unknown }>).map((r) => ({
      lotNo: r.lotNo,
      expDate: r.expDate || "",
      receivedOn: r.receivedOn || "",
      quantity: num(r.quantity),
      daysUntilExpiry: r.expDate ? daysFromToday(r.expDate) : null
    }))
  };
}
