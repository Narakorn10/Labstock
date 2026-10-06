import sql from "@/lib/db";
import { computeReorderInsight, daysFromToday, type ReorderStatus } from "@/lib/reagent-usage-insights";

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
  };
  reorder: {
    dispensedLast90Days: number;
    averageDailyUsage: number;
    daysUntilMin: number | null;
    status: ReorderStatus;
    recommendedOrderQty: number;
  };
  daily: Array<{ date: string; qty: number }>;
  monthly: Array<{ month: string; qty: number }>;
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

function daysInRange(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

/** Usage detail of one reagent for the Analysis "รายน้ำยา" tab. Returns null when the item does not exist. */
export async function getReagentItemUsage(itemId: string, startDate: string, endDate: string): Promise<ItemUsageDetail | null> {
  const itemRows = await sql`
    SELECT
      m.item_id AS "itemId",
      m.name,
      m.unit,
      m.min_threshold AS "minThreshold",
      m.is_active AS "isActive",
      (SELECT COALESCE(SUM(quantity), 0) FROM inventory WHERE item_id = m.item_id) AS quantity,
      (
        SELECT COALESCE(SUM(quantity), 0) FROM logs
        WHERE item_id = m.item_id
          AND action = ${DISPENSE_ACTION}
          AND timestamp >= CURRENT_DATE - INTERVAL '90 days'
      ) AS "dispensedLast90Days"
    FROM master_data m
    WHERE m.item_id = ${itemId}
  `;
  const row = (itemRows as unknown as ItemRow[])[0];
  if (!row) return null;

  const [totalRows, dailyRows, monthlyRows, lotRows, userRows, onHandRows] = await Promise.all([
    sql`
      SELECT
        SUM(CASE WHEN action = ${DISPENSE_ACTION} THEN quantity ELSE 0 END) AS dispensed,
        SUM(CASE WHEN action = ${RECEIVE_ACTION} THEN quantity ELSE 0 END) AS received,
        SUM(CASE WHEN action LIKE '%ปรับปรุงยอด%' THEN quantity ELSE 0 END) AS adjusted,
        COUNT(*) FILTER (WHERE action = ${DISPENSE_ACTION}) AS "dispenseCount",
        MAX(timestamp) FILTER (WHERE action = ${DISPENSE_ACTION}) AS "lastDispensedAt"
      FROM logs
      WHERE item_id = ${itemId}
        AND timestamp >= ${startDate}::date
        AND timestamp < (${endDate}::date + INTERVAL '1 day')
    `,
    sql`
      SELECT TO_CHAR(timestamp, 'YYYY-MM-DD') AS date, SUM(quantity) AS qty
      FROM logs
      WHERE item_id = ${itemId}
        AND action = ${DISPENSE_ACTION}
        AND timestamp >= ${startDate}::date
        AND timestamp < (${endDate}::date + INTERVAL '1 day')
      GROUP BY date
      ORDER BY date ASC
    `,
    sql`
      SELECT TO_CHAR(timestamp, 'YYYY-MM') AS month, SUM(quantity) AS qty
      FROM logs
      WHERE item_id = ${itemId}
        AND action = ${DISPENSE_ACTION}
        AND timestamp >= ${startDate}::date
        AND timestamp < (${endDate}::date + INTERVAL '1 day')
      GROUP BY month
      ORDER BY month ASC
    `,
    sql`
      SELECT COALESCE(NULLIF(lot_no, ''), '-') AS "lotNo", SUM(quantity) AS qty
      FROM logs
      WHERE item_id = ${itemId}
        AND action = ${DISPENSE_ACTION}
        AND timestamp >= ${startDate}::date
        AND timestamp < (${endDate}::date + INTERVAL '1 day')
      GROUP BY 1
      ORDER BY qty DESC
    `,
    sql`
      SELECT COALESCE(NULLIF(username, ''), '-') AS username, SUM(quantity) AS qty, COUNT(*) AS count
      FROM logs
      WHERE item_id = ${itemId}
        AND action = ${DISPENSE_ACTION}
        AND timestamp >= ${startDate}::date
        AND timestamp < (${endDate}::date + INTERVAL '1 day')
      GROUP BY 1
      ORDER BY qty DESC
      LIMIT ${TOP_USERS_LIMIT}
    `,
    sql`
      SELECT lot_no AS "lotNo", exp_date::text AS "expDate", received_on::text AS "receivedOn", quantity
      FROM inventory
      WHERE item_id = ${itemId} AND quantity > 0
      ORDER BY NULLIF(exp_date::text, '') ASC NULLS LAST, received_on ASC
    `
  ]);

  const totals = (totalRows as Array<Record<string, unknown>>)[0] || {};
  const days = daysInRange(startDate, endDate);
  const dispensed = num(totals.dispensed);
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
      lastDispensedAt: totals.lastDispensedAt ? new Date(String(totals.lastDispensedAt)).toISOString() : null
    },
    reorder: { dispensedLast90Days, averageDailyUsage, daysUntilMin, status, recommendedOrderQty },
    daily: (dailyRows as Array<{ date: string; qty: unknown }>).map((r) => ({ date: r.date, qty: num(r.qty) })),
    monthly: (monthlyRows as Array<{ month: string; qty: unknown }>).map((r) => ({ month: r.month, qty: num(r.qty) })),
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
