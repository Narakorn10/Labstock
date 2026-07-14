import sql from "@/lib/db";

export const USAGE_LOOKBACK_DAYS = 90;
export const LEAD_TIME_DAYS = 7;
export const REVIEW_PERIOD_DAYS = 7;

export type ReorderStatus = "normal" | "reorder" | "critical";

export interface ReagentUsageInsight {
  itemId: string;
  name: string;
  unit: string;
  quantity: number;
  minThreshold: number;
  dispensedLast90Days: number;
  averageDailyUsage: number;
  daysUntilMin: number | null;
  status: ReorderStatus;
  recommendedOrderQty: number;
}

export interface ExpiryRiskInsight {
  itemId: string;
  name: string;
  unit: string;
  lotNo: string;
  expDate: string;
  quantity: number;
  daysUntilExpiry: number;
  expectedDaysToUse: number | null;
  isExpiryRisk: boolean;
}

type InsightRow = {
  itemId: string;
  name: string;
  unit: string | null;
  quantity: string | number;
  minThreshold: string | number;
  dispensedLast90Days: string | number;
};

type LotRow = {
  itemId: string;
  name: string;
  unit: string | null;
  lotNo: string;
  expDate: string;
  quantity: string | number;
};

function asNumber(value: string | number | null | undefined) {
  return Number(value) || 0;
}

function daysFromToday(dateValue: string) {
  const date = new Date(`${dateValue.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((date.getTime() - startOfToday) / 86_400_000);
}

export async function getReagentUsageInsights() {
  const [insightRows, lotRows] = await Promise.all([
    sql`
      WITH recent_usage AS (
        SELECT item_id, SUM(quantity) AS dispensed
        FROM logs
        WHERE action = 'เบิกไปหน้างาน'
          AND timestamp >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY item_id
      ), inventory_summary AS (
        SELECT item_id, SUM(quantity) AS quantity
        FROM inventory
        GROUP BY item_id
      )
      SELECT
        m.item_id AS "itemId",
        m.name,
        m.unit,
        COALESCE(i.quantity, 0) AS quantity,
        COALESCE(m.min_threshold, 0) AS "minThreshold",
        COALESCE(u.dispensed, 0) AS "dispensedLast90Days"
      FROM master_data m
      LEFT JOIN inventory_summary i ON i.item_id = m.item_id
      LEFT JOIN recent_usage u ON u.item_id = m.item_id
      ORDER BY m.name ASC
    `,
    sql`
      SELECT
        i.item_id AS "itemId",
        m.name,
        m.unit,
        i.lot_no AS "lotNo",
        i.exp_date AS "expDate",
        i.quantity
      FROM inventory i
      JOIN master_data m ON m.item_id = i.item_id
      WHERE i.quantity > 0
        AND i.exp_date IS NOT NULL
        AND i.exp_date::text <> ''
      ORDER BY i.item_id ASC, i.exp_date ASC
    `
  ]);

  const insights = (insightRows as unknown as InsightRow[]).map((row) => {
    const quantity = asNumber(row.quantity);
    const minThreshold = asNumber(row.minThreshold);
    const dispensedLast90Days = asNumber(row.dispensedLast90Days);
    const averageDailyUsage = dispensedLast90Days / USAGE_LOOKBACK_DAYS;
    const daysUntilMin = averageDailyUsage > 0
      ? Math.max(0, (quantity - minThreshold) / averageDailyUsage)
      : null;
    const targetQuantity = Math.ceil(
      (LEAD_TIME_DAYS + REVIEW_PERIOD_DAYS) * averageDailyUsage + minThreshold
    );

    let status: ReorderStatus = "normal";
    if (quantity <= minThreshold || (daysUntilMin !== null && daysUntilMin <= LEAD_TIME_DAYS)) {
      status = "critical";
    } else if (daysUntilMin !== null && daysUntilMin <= LEAD_TIME_DAYS + REVIEW_PERIOD_DAYS) {
      status = "reorder";
    }

    return {
      itemId: row.itemId,
      name: row.name,
      unit: row.unit || "หน่วย",
      quantity,
      minThreshold,
      dispensedLast90Days,
      averageDailyUsage,
      daysUntilMin,
      status,
      recommendedOrderQty: status === "normal" ? 0 : Math.max(0, targetQuantity - quantity)
    } satisfies ReagentUsageInsight;
  });

  const insightByItemId = new Map(insights.map((insight) => [insight.itemId, insight]));
  const cumulativeByItemId = new Map<string, number>();
  const expiryRisks = (lotRows as unknown as LotRow[]).map((lot) => {
    const quantity = asNumber(lot.quantity);
    const cumulativeQuantity = (cumulativeByItemId.get(lot.itemId) || 0) + quantity;
    cumulativeByItemId.set(lot.itemId, cumulativeQuantity);

    const usage = insightByItemId.get(lot.itemId);
    const expectedDaysToUse = usage && usage.averageDailyUsage > 0
      ? cumulativeQuantity / usage.averageDailyUsage
      : null;
    const daysUntilExpiry = daysFromToday(String(lot.expDate));
    const isExpiryRisk = daysUntilExpiry !== null && (
      expectedDaysToUse === null || expectedDaysToUse > daysUntilExpiry
    );

    return {
      itemId: lot.itemId,
      name: lot.name,
      unit: lot.unit || "หน่วย",
      lotNo: lot.lotNo,
      expDate: String(lot.expDate),
      quantity,
      daysUntilExpiry: daysUntilExpiry ?? 0,
      expectedDaysToUse,
      isExpiryRisk
    } satisfies ExpiryRiskInsight;
  }).filter((lot) => lot.isExpiryRisk).sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  return { insights, expiryRisks };
}
