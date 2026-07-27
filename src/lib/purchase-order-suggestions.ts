type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

export type PurchaseOrderSuggestion = {
  item_id: string;
  name: string;
  unit: string;
  vendor?: string;
  min_threshold: number;
  weekly_target: number;
  quantity: number;
  suggested_order_qty: number;
  system_suggested_order_qty: number;
  on_order_qty: number;
  committed_no_eta_qty: number;
  projected_balance_at_horizon: number;
  minimum_projected_balance: number;
  safety_stock_boxes: number;
  monthly_target_boxes: number;
  orders_per_month: number;
  lead_time_days: number;
  review_days: number;
  horizon_days: number;
  expedite_required: boolean;
  stockout_date: string | null;
  calculation_version: string;
  warnings: string[];
  calculation_breakdown: {
    demandSource: "approved_policy" | "policy_formula" | "weekly_target";
    dailyDemandBoxes: number;
    bridgeRequirementBoxes: number;
    endingSafetyGapBoxes: number;
    rawOrderBoxes: number;
    orderMultipleBoxes: number;
    minOrderQtyBoxes: number;
  };
};

type SuggestionRow = {
  item_id: string;
  name: string;
  unit: string;
  vendor?: string | null;
  min_threshold: unknown;
  weekly_target: unknown;
  quantity: unknown;
  tests_per_box?: unknown;
  avg_patient_tests_per_month?: unknown;
  iqc_tests_per_month?: unknown;
  approved_monthly_target_boxes?: unknown;
  orders_per_month?: unknown;
  lead_time_days?: unknown;
  safety_stock_boxes?: unknown;
  min_order_qty_boxes?: unknown;
  order_multiple_boxes?: unknown;
  inventory_lots?: unknown;
  on_order_lots?: unknown;
  committed_no_eta_qty?: unknown;
};

type InventoryLot = {
  quantity: number;
  expDate: string | null;
};

type OnOrderLot = {
  quantity: number;
  etaDate: string | null;
};

type FetchSuggestionOptions = {
  vendor?: string | null;
  keyword?: string;
  includeAll?: boolean;
  limit?: number;
};

const CALCULATION_VERSION = "reagent-order-suggestion-v2";
const DEFAULT_LEAD_TIME_DAYS = 7;
const DAYS_PER_MONTH = 30;

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toPositiveNumber(value: unknown, fallback: number) {
  const numberValue = toNumber(value, fallback);
  return numberValue > 0 ? numberValue : fallback;
}

function toArray(value: unknown): Record<string, unknown>[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return toArray(parsed);
    } catch {
      return [];
    }
  }

  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object") : [];
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value: unknown) {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function roundUpToMultiple(value: number, multiple: number) {
  const safeMultiple = Math.max(1, Math.ceil(multiple));
  return Math.ceil(value / safeMultiple) * safeMultiple;
}

function normalizeInventoryLots(value: unknown): InventoryLot[] {
  return toArray(value)
    .map((lot) => ({
      quantity: Math.max(0, toNumber(lot.quantity)),
      expDate: lot.exp_date ? String(lot.exp_date) : null,
    }))
    .filter((lot) => lot.quantity > 0)
    .sort((left, right) => {
      const leftDate = left.expDate ?? "9999-12-31";
      const rightDate = right.expDate ?? "9999-12-31";
      return leftDate.localeCompare(rightDate);
    });
}

function normalizeOnOrderLots(value: unknown): OnOrderLot[] {
  return toArray(value)
    .map((lot) => ({
      quantity: Math.max(0, toNumber(lot.quantity)),
      etaDate: lot.eta_date ? String(lot.eta_date) : null,
    }))
    .filter((lot) => lot.quantity > 0);
}

function consumeFefo(lots: InventoryLot[], demand: number, currentDate: Date) {
  let remainingDemand = demand;
  const currentDateText = dateOnly(currentDate);
  const activeLots = lots
    .filter((lot) => !lot.expDate || lot.expDate >= currentDateText)
    .sort((left, right) => (left.expDate ?? "9999-12-31").localeCompare(right.expDate ?? "9999-12-31"));

  for (const lot of activeLots) {
    if (remainingDemand <= 0) break;
    const consumed = Math.min(lot.quantity, remainingDemand);
    lot.quantity -= consumed;
    remainingDemand -= consumed;
  }

  return activeLots.filter((lot) => lot.quantity > 0);
}

function sumLots(lots: InventoryLot[]) {
  return lots.reduce((sum, lot) => sum + lot.quantity, 0);
}

function calculateSuggestion(row: SuggestionRow, now = new Date()): PurchaseOrderSuggestion {
  const minThreshold = Math.max(0, toNumber(row.min_threshold));
  const weeklyTarget = Math.max(0, toNumber(row.weekly_target));
  const currentQty = Math.max(0, toNumber(row.quantity));
  const ordersPerMonth = toPositiveNumber(row.orders_per_month, 1);
  const leadTimeDays = Math.max(0, Math.ceil(toNumber(row.lead_time_days, DEFAULT_LEAD_TIME_DAYS)));
  const reviewDays = Math.ceil(DAYS_PER_MONTH / ordersPerMonth);
  const horizonDays = leadTimeDays + reviewDays;
  const testsPerBox = toNumber(row.tests_per_box);
  const avgPatientTests = toNumber(row.avg_patient_tests_per_month);
  const iqcTests = toNumber(row.iqc_tests_per_month);
  const approvedMonthlyTarget = toNumber(row.approved_monthly_target_boxes);
  const policyFormulaMonthlyTarget = testsPerBox > 0 ? (avgPatientTests + iqcTests) / testsPerBox : 0;
  const fallbackMonthlyTarget = weeklyTarget * 4;
  const monthlyTargetBoxes = approvedMonthlyTarget > 0
    ? approvedMonthlyTarget
    : policyFormulaMonthlyTarget > 0
      ? policyFormulaMonthlyTarget
      : fallbackMonthlyTarget;
  const demandSource = approvedMonthlyTarget > 0 ? "approved_policy" : policyFormulaMonthlyTarget > 0 ? "policy_formula" : "weekly_target";
  const dailyDemand = monthlyTargetBoxes / DAYS_PER_MONTH;
  const safetyStockBoxes = Math.max(minThreshold, toNumber(row.safety_stock_boxes, minThreshold));
  const minOrderQtyBoxes = Math.max(1, Math.ceil(toNumber(row.min_order_qty_boxes, 1)));
  const orderMultipleBoxes = Math.max(1, Math.ceil(toNumber(row.order_multiple_boxes, 1)));
  const onOrderLots = normalizeOnOrderLots(row.on_order_lots);
  const committedNoEtaQty = Math.max(0, toNumber(row.committed_no_eta_qty));
  let inventoryLots = normalizeInventoryLots(row.inventory_lots);
  let minimumProjectedBalance = sumLots(inventoryLots);
  let projectedBalanceAtLead = minimumProjectedBalance;
  let projectedBalanceAtHorizon = minimumProjectedBalance;
  let stockoutDate: string | null = null;

  for (let day = 0; day <= horizonDays; day += 1) {
    const currentDate = addDays(now, day);
    const currentDateText = dateOnly(currentDate);

    for (const arrival of onOrderLots) {
      if (arrival.etaDate === currentDateText) {
        inventoryLots.push({ quantity: arrival.quantity, expDate: null });
      }
    }

    if (day > 0 && dailyDemand > 0) {
      inventoryLots = consumeFefo(inventoryLots, dailyDemand, currentDate);
    } else {
      inventoryLots = inventoryLots.filter((lot) => !lot.expDate || lot.expDate >= currentDateText);
    }

    const projectedBalance = sumLots(inventoryLots);
    if (day === leadTimeDays) projectedBalanceAtLead = projectedBalance;
    if (day === horizonDays) projectedBalanceAtHorizon = projectedBalance;
    if (projectedBalance < minimumProjectedBalance) minimumProjectedBalance = projectedBalance;
    if (!stockoutDate && projectedBalance <= 0 && dailyDemand > 0) stockoutDate = currentDateText;
  }

  const bridgeRequirementBoxes = Math.max(0, -projectedBalanceAtLead);
  const endingSafetyGapBoxes = Math.max(0, safetyStockBoxes - projectedBalanceAtHorizon);
  const rawOrderBoxes = Math.max(bridgeRequirementBoxes, endingSafetyGapBoxes);
  const systemSuggestedQty = rawOrderBoxes === 0
    ? 0
    : Math.max(minOrderQtyBoxes, roundUpToMultiple(rawOrderBoxes, orderMultipleBoxes));
  const warnings: string[] = [];
  const stockoutParsed = parseDateOnly(stockoutDate);
  const leadDate = addDays(now, leadTimeDays);

  if (committedNoEtaQty > 0) {
    warnings.push("There are committed purchase orders without ETA, so they were not counted in projected arrivals.");
  }
  if (stockoutParsed && stockoutParsed < leadDate) {
    warnings.push("Projected stockout occurs before the lead time window; expedite purchasing or manual intervention is required.");
  }
  if (demandSource === "weekly_target") {
    warnings.push("No reagent order policy was found; calculation used weekly_target as monthly demand fallback.");
  }

  return {
    item_id: row.item_id,
    name: row.name,
    unit: row.unit,
    vendor: row.vendor ?? undefined,
    min_threshold: minThreshold,
    weekly_target: weeklyTarget,
    quantity: currentQty,
    suggested_order_qty: systemSuggestedQty,
    system_suggested_order_qty: systemSuggestedQty,
    on_order_qty: onOrderLots.reduce((sum, lot) => sum + lot.quantity, 0),
    committed_no_eta_qty: committedNoEtaQty,
    projected_balance_at_horizon: Math.max(0, Math.round(projectedBalanceAtHorizon * 100) / 100),
    minimum_projected_balance: Math.round(minimumProjectedBalance * 100) / 100,
    safety_stock_boxes: safetyStockBoxes,
    monthly_target_boxes: Math.round(monthlyTargetBoxes * 100) / 100,
    orders_per_month: ordersPerMonth,
    lead_time_days: leadTimeDays,
    review_days: reviewDays,
    horizon_days: horizonDays,
    expedite_required: Boolean(stockoutParsed && stockoutParsed < leadDate),
    stockout_date: stockoutDate,
    calculation_version: CALCULATION_VERSION,
    warnings,
    calculation_breakdown: {
      demandSource,
      dailyDemandBoxes: Math.round(dailyDemand * 1000) / 1000,
      bridgeRequirementBoxes: Math.round(bridgeRequirementBoxes * 100) / 100,
      endingSafetyGapBoxes: Math.round(endingSafetyGapBoxes * 100) / 100,
      rawOrderBoxes: Math.round(rawOrderBoxes * 100) / 100,
      orderMultipleBoxes,
      minOrderQtyBoxes,
    },
  };
}

async function hasPolicyTable(sql: SqlClient) {
  const rows = await sql`SELECT to_regclass('public.reagent_order_policy') AS table_name`;
  return Boolean(rows[0]?.table_name);
}

export async function getPurchaseOrderSuggestions(sql: SqlClient, options: FetchSuggestionOptions = {}) {
  const policyTableExists = await hasPolicyTable(sql);
  const vendor = options.vendor?.trim() || null;
  const keyword = options.keyword?.trim() || "";
  const searchTerm = `%${keyword}%`;
  const limit = Math.max(1, Math.min(100, options.limit ?? 100));
  const rows = policyTableExists
    ? vendor
      ? keyword
        ? await sql`
          WITH inventory_lots AS (
            SELECT item_id, jsonb_agg(jsonb_build_object('quantity', quantity::numeric, 'exp_date', NULLIF(exp_date::text, '')::date) ORDER BY NULLIF(exp_date::text, '')::date ASC NULLS LAST, received_on ASC, id ASC) AS lots,
              COALESCE(SUM(quantity), 0) AS current_qty
            FROM inventory
            WHERE quantity > 0
            GROUP BY item_id
          ),
          on_order AS (
            SELECT poi.item_id,
              jsonb_agg(jsonb_build_object('quantity', GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0), 'eta_date', NULLIF(p.expected_date::text, '')::date) ORDER BY NULLIF(p.expected_date::text, '')::date ASC) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NOT NULL) AS lots,
              COALESCE(SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0)) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NULL), 0) AS no_eta_qty
            FROM purchase_order_items poi
            JOIN purchase_orders p ON p.id = poi.po_id
            WHERE p.status IN ('SUBMITTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
              AND GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0) > 0
            GROUP BY poi.item_id
          )
          SELECT m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
            COALESCE(i.current_qty, 0) AS quantity,
            p.tests_per_box, p.avg_patient_tests_per_month, p.iqc_tests_per_month,
            p.approved_monthly_target_boxes, p.orders_per_month, p.lead_time_days,
            p.safety_stock_boxes, p.min_order_qty_boxes, p.order_multiple_boxes,
            COALESCE(i.lots, '[]'::jsonb) AS inventory_lots,
            COALESCE(o.lots, '[]'::jsonb) AS on_order_lots,
            COALESCE(o.no_eta_qty, 0) AS committed_no_eta_qty
          FROM master_data m
          LEFT JOIN reagent_order_policy p ON p.item_id = m.item_id AND p.enabled = true
          LEFT JOIN inventory_lots i ON i.item_id = m.item_id
          LEFT JOIN on_order o ON o.item_id = m.item_id
          WHERE m.vendor = ${vendor}
            AND (m.item_id ILIKE ${searchTerm} OR m.name ILIKE ${searchTerm} OR COALESCE(m.barcode, '') ILIKE ${searchTerm})
          ORDER BY COALESCE(i.current_qty, 0), m.name
          LIMIT ${limit}
        `
        : await sql`
          WITH inventory_lots AS (
            SELECT item_id, jsonb_agg(jsonb_build_object('quantity', quantity::numeric, 'exp_date', NULLIF(exp_date::text, '')::date) ORDER BY NULLIF(exp_date::text, '')::date ASC NULLS LAST, received_on ASC, id ASC) AS lots,
              COALESCE(SUM(quantity), 0) AS current_qty
            FROM inventory
            WHERE quantity > 0
            GROUP BY item_id
          ),
          on_order AS (
            SELECT poi.item_id,
              jsonb_agg(jsonb_build_object('quantity', GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0), 'eta_date', NULLIF(p.expected_date::text, '')::date) ORDER BY NULLIF(p.expected_date::text, '')::date ASC) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NOT NULL) AS lots,
              COALESCE(SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0)) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NULL), 0) AS no_eta_qty
            FROM purchase_order_items poi
            JOIN purchase_orders p ON p.id = poi.po_id
            WHERE p.status IN ('SUBMITTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
              AND GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0) > 0
            GROUP BY poi.item_id
          )
          SELECT m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
            COALESCE(i.current_qty, 0) AS quantity,
            p.tests_per_box, p.avg_patient_tests_per_month, p.iqc_tests_per_month,
            p.approved_monthly_target_boxes, p.orders_per_month, p.lead_time_days,
            p.safety_stock_boxes, p.min_order_qty_boxes, p.order_multiple_boxes,
            COALESCE(i.lots, '[]'::jsonb) AS inventory_lots,
            COALESCE(o.lots, '[]'::jsonb) AS on_order_lots,
            COALESCE(o.no_eta_qty, 0) AS committed_no_eta_qty
          FROM master_data m
          LEFT JOIN reagent_order_policy p ON p.item_id = m.item_id AND p.enabled = true
          LEFT JOIN inventory_lots i ON i.item_id = m.item_id
          LEFT JOIN on_order o ON o.item_id = m.item_id
          WHERE m.vendor = ${vendor}
          ORDER BY COALESCE(i.current_qty, 0), m.name
          LIMIT ${limit}
        `
      : await sql`
        WITH inventory_lots AS (
          SELECT item_id, jsonb_agg(jsonb_build_object('quantity', quantity::numeric, 'exp_date', NULLIF(exp_date::text, '')::date) ORDER BY NULLIF(exp_date::text, '')::date ASC NULLS LAST, received_on ASC, id ASC) AS lots,
            COALESCE(SUM(quantity), 0) AS current_qty
          FROM inventory
          WHERE quantity > 0
          GROUP BY item_id
        ),
        on_order AS (
          SELECT poi.item_id,
            jsonb_agg(jsonb_build_object('quantity', GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0), 'eta_date', NULLIF(p.expected_date::text, '')::date) ORDER BY NULLIF(p.expected_date::text, '')::date ASC) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NOT NULL) AS lots,
            COALESCE(SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0)) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NULL), 0) AS no_eta_qty
          FROM purchase_order_items poi
          JOIN purchase_orders p ON p.id = poi.po_id
          WHERE p.status IN ('SUBMITTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
            AND GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0) > 0
          GROUP BY poi.item_id
        )
        SELECT m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
          COALESCE(i.current_qty, 0) AS quantity,
          p.tests_per_box, p.avg_patient_tests_per_month, p.iqc_tests_per_month,
          p.approved_monthly_target_boxes, p.orders_per_month, p.lead_time_days,
          p.safety_stock_boxes, p.min_order_qty_boxes, p.order_multiple_boxes,
          COALESCE(i.lots, '[]'::jsonb) AS inventory_lots,
          COALESCE(o.lots, '[]'::jsonb) AS on_order_lots,
          COALESCE(o.no_eta_qty, 0) AS committed_no_eta_qty
        FROM master_data m
        LEFT JOIN reagent_order_policy p ON p.item_id = m.item_id AND p.enabled = true
        LEFT JOIN inventory_lots i ON i.item_id = m.item_id
        LEFT JOIN on_order o ON o.item_id = m.item_id
        ORDER BY COALESCE(i.current_qty, 0), m.name
        LIMIT ${limit}
      `
    : vendor
      ? keyword
        ? await sql`
          WITH inventory_lots AS (
            SELECT item_id, jsonb_agg(jsonb_build_object('quantity', quantity::numeric, 'exp_date', NULLIF(exp_date::text, '')::date) ORDER BY NULLIF(exp_date::text, '')::date ASC NULLS LAST, received_on ASC, id ASC) AS lots,
              COALESCE(SUM(quantity), 0) AS current_qty
            FROM inventory
            WHERE quantity > 0
            GROUP BY item_id
          ),
          on_order AS (
            SELECT poi.item_id,
              jsonb_agg(jsonb_build_object('quantity', GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0), 'eta_date', NULLIF(p.expected_date::text, '')::date) ORDER BY NULLIF(p.expected_date::text, '')::date ASC) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NOT NULL) AS lots,
              COALESCE(SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0)) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NULL), 0) AS no_eta_qty
            FROM purchase_order_items poi
            JOIN purchase_orders p ON p.id = poi.po_id
            WHERE p.status IN ('SUBMITTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
              AND GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0) > 0
            GROUP BY poi.item_id
          )
          SELECT m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
            COALESCE(i.current_qty, 0) AS quantity,
            COALESCE(i.lots, '[]'::jsonb) AS inventory_lots,
            COALESCE(o.lots, '[]'::jsonb) AS on_order_lots,
            COALESCE(o.no_eta_qty, 0) AS committed_no_eta_qty
          FROM master_data m
          LEFT JOIN inventory_lots i ON i.item_id = m.item_id
          LEFT JOIN on_order o ON o.item_id = m.item_id
          WHERE m.vendor = ${vendor}
            AND (m.item_id ILIKE ${searchTerm} OR m.name ILIKE ${searchTerm} OR COALESCE(m.barcode, '') ILIKE ${searchTerm})
          ORDER BY COALESCE(i.current_qty, 0), m.name
          LIMIT ${limit}
        `
        : await sql`
          WITH inventory_lots AS (
            SELECT item_id, jsonb_agg(jsonb_build_object('quantity', quantity::numeric, 'exp_date', NULLIF(exp_date::text, '')::date) ORDER BY NULLIF(exp_date::text, '')::date ASC NULLS LAST, received_on ASC, id ASC) AS lots,
              COALESCE(SUM(quantity), 0) AS current_qty
            FROM inventory
            WHERE quantity > 0
            GROUP BY item_id
          ),
          on_order AS (
            SELECT poi.item_id,
              jsonb_agg(jsonb_build_object('quantity', GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0), 'eta_date', NULLIF(p.expected_date::text, '')::date) ORDER BY NULLIF(p.expected_date::text, '')::date ASC) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NOT NULL) AS lots,
              COALESCE(SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0)) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NULL), 0) AS no_eta_qty
            FROM purchase_order_items poi
            JOIN purchase_orders p ON p.id = poi.po_id
            WHERE p.status IN ('SUBMITTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
              AND GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0) > 0
            GROUP BY poi.item_id
          )
          SELECT m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
            COALESCE(i.current_qty, 0) AS quantity,
            COALESCE(i.lots, '[]'::jsonb) AS inventory_lots,
            COALESCE(o.lots, '[]'::jsonb) AS on_order_lots,
            COALESCE(o.no_eta_qty, 0) AS committed_no_eta_qty
          FROM master_data m
          LEFT JOIN inventory_lots i ON i.item_id = m.item_id
          LEFT JOIN on_order o ON o.item_id = m.item_id
          WHERE m.vendor = ${vendor}
          ORDER BY COALESCE(i.current_qty, 0), m.name
          LIMIT ${limit}
        `
      : await sql`
        WITH inventory_lots AS (
          SELECT item_id, jsonb_agg(jsonb_build_object('quantity', quantity::numeric, 'exp_date', NULLIF(exp_date::text, '')::date) ORDER BY NULLIF(exp_date::text, '')::date ASC NULLS LAST, received_on ASC, id ASC) AS lots,
            COALESCE(SUM(quantity), 0) AS current_qty
          FROM inventory
          WHERE quantity > 0
          GROUP BY item_id
        ),
        on_order AS (
          SELECT poi.item_id,
            jsonb_agg(jsonb_build_object('quantity', GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0), 'eta_date', NULLIF(p.expected_date::text, '')::date) ORDER BY NULLIF(p.expected_date::text, '')::date ASC) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NOT NULL) AS lots,
            COALESCE(SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0)) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NULL), 0) AS no_eta_qty
          FROM purchase_order_items poi
          JOIN purchase_orders p ON p.id = poi.po_id
          WHERE p.status IN ('SUBMITTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
            AND GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0) > 0
          GROUP BY poi.item_id
        )
        SELECT m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
          COALESCE(i.current_qty, 0) AS quantity,
          COALESCE(i.lots, '[]'::jsonb) AS inventory_lots,
          COALESCE(o.lots, '[]'::jsonb) AS on_order_lots,
          COALESCE(o.no_eta_qty, 0) AS committed_no_eta_qty
        FROM master_data m
        LEFT JOIN inventory_lots i ON i.item_id = m.item_id
        LEFT JOIN on_order o ON o.item_id = m.item_id
        ORDER BY COALESCE(i.current_qty, 0), m.name
        LIMIT ${limit}
      `;

  return (rows as SuggestionRow[])
    .map((row) => calculateSuggestion(row))
    .filter((item) => options.includeAll || item.suggested_order_qty > 0 || item.expedite_required);
}
