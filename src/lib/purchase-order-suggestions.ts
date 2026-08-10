type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

export type SuggestionConfidence = "high" | "low" | "none";

export type SuggestionDataQuality = {
  observation_span_days: number;
  observed_calendar_days: number;
  future_dispense_log_count: number;
  live_usage_eligible: boolean;
};

export type PurchaseOrderSuggestion = {
  item_id: string;
  name: string;
  unit: string;
  vendor?: string;
  min_threshold: number;
  weekly_target: number;
  quantity: number;
  /** Legacy quantity used by existing clients. It remains the policy/default PO quantity. */
  suggested_order_qty: number;
  /** Kept for v4 callers; it has the same policy-default meaning as suggested_order_qty. */
  system_suggested_order_qty: number;
  policy_order_qty: number;
  dynamic_order_qty: number;
  theoretical_monthly_qty: number | null;
  documented_actual_withdrawal_boxes: number | null;
  variance_abs_qty: number;
  variance_percent: number | null;
  variance_requires_review: boolean;
  confidence: SuggestionConfidence;
  data_quality: SuggestionDataQuality;
  review_reasons: string[];
  auto_selectable: boolean;
  on_order_qty: number;
  committed_no_eta_qty: number;
  projected_balance_at_horizon: number;
  minimum_projected_balance: number;
  safety_stock_boxes: number;
  monthly_target_boxes: number;
  planned_order_qty_boxes: number;
  orders_per_month: number;
  lead_time_days: number;
  review_days: number;
  horizon_days: number;
  expedite_required: boolean;
  stockout_date: string | null;
  expiry_assessment: {
    expired_qty_excluded: number;
    expiring_within_horizon_qty: number;
    nearest_expiry_date: string | null;
  };
  calculation_version: string;
  warnings: string[];
  calculation_breakdown: {
    demandSource:
      | "actual_dispense_history"
      | "approved_policy"
      | "documented_withdrawal"
      | "policy_formula"
      | "weekly_target";
    dailyDemandBoxes: number;
    bridgeRequirementBoxes: number;
    endingSafetyGapBoxes: number;
    rawOrderBoxes: number;
    orderMultipleBoxes: number;
    minOrderQtyBoxes: number;
  };
};

export type SuggestionRow = {
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
  documented_actual_withdrawal_boxes?: unknown;
  approved_monthly_target_boxes?: unknown;
  approved_order_qty_boxes?: unknown;
  orders_per_month?: unknown;
  lead_time_days?: unknown;
  safety_stock_boxes?: unknown;
  min_order_qty_boxes?: unknown;
  order_multiple_boxes?: unknown;
  source_verification_status?: unknown;
  revision?: unknown;
  inventory_lots?: unknown;
  on_order_lots?: unknown;
  committed_no_eta_qty?: unknown;
  dispensed_14d?: unknown;
  dispense_observation_days?: unknown;
  dispense_observed_calendar_days?: unknown;
  future_dispense_log_count?: unknown;
};

export type FetchSuggestionOptions = {
  vendor?: string | null;
  keyword?: string;
  includeAll?: boolean;
  limit?: number;
};

type InventoryLot = {
  quantity: number;
  expDate: string | null;
};

type OnOrderLot = {
  quantity: number;
  etaDate: string | null;
};

const CALCULATION_VERSION = "reagent-order-suggestion-v6-14d-cycle-5d-lead-fefo";
const DEFAULT_LEAD_TIME_DAYS = 5;
const DAYS_PER_MONTH = 30;
const ORDERS_PER_MONTH = 2;
const TARGET_ORDER_COVERAGE_DAYS = 14;
const LIVE_USAGE_MIN_OBSERVATION_DAYS = 7;
const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const DISPENSE_ACTION = "\u0e40\u0e1a\u0e34\u0e01\u0e44\u0e1b\u0e2b\u0e19\u0e49\u0e32\u0e07\u0e32\u0e19";

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
      return toArray(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }

  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
    : [];
}

function roundToDecimals(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function bangkokDateOnly(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function startOfBangkokDate(date: Date) {
  return new Date(`${bangkokDateOnly(date)}T00:00:00.000Z`);
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
      expDate: lot.exp_date ? String(lot.exp_date).slice(0, 10) : null,
    }))
    .filter((lot) => lot.quantity > 0)
    .sort((left, right) => (left.expDate ?? "9999-12-31").localeCompare(right.expDate ?? "9999-12-31"));
}

function normalizeOnOrderLots(value: unknown): OnOrderLot[] {
  return toArray(value)
    .map((lot) => ({
      quantity: Math.max(0, toNumber(lot.quantity)),
      etaDate: lot.eta_date ? String(lot.eta_date).slice(0, 10) : null,
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

  return {
    lots: activeLots.filter((lot) => lot.quantity > 0),
    unmetDemand: Math.max(0, remainingDemand),
  };
}

function sumLots(lots: InventoryLot[]) {
  return lots.reduce((sum, lot) => sum + lot.quantity, 0);
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function normalizeVerificationStatus(value: unknown) {
  const status = String(value ?? "NOT_AVAILABLE").toUpperCase();
  return status === "VERIFIED" || status === "NEEDS_REVIEW" || status === "NOT_AVAILABLE"
    ? status
    : "NOT_AVAILABLE";
}

function warningForReviewReason(reason: string) {
  const messages: Record<string, string> = {
    NO_DISPENSE_HISTORY: "No positive exact front-line dispensing history was found in the last 14 Bangkok calendar dates.",
    INSUFFICIENT_DISPENSE_HISTORY: "Live dispensing history spans fewer than seven Bangkok calendar days, so policy demand was used for projection.",
    FUTURE_DISPENSE_LOGS_EXCLUDED: "Future-dated dispensing logs were excluded from the live-usage calculation.",
    OPEN_PURCHASE_ORDER_WITHOUT_ETA: "There are committed purchase orders without ETA, so they were not counted in projected arrivals.",
    STOCKOUT_BEFORE_LEAD_TIME: "Projected stockout occurs before the lead time window; expedite purchasing or manual intervention is required.",
    POLICY_SOURCE_NEEDS_REVIEW: "This policy is marked NEEDS_REVIEW and requires an Admin check before auto-selection.",
    MISSING_APPROVED_CYCLE_QTY: "No lab-approved cycle quantity is recorded; select a basis manually before creating a PO.",
    POLICY_DYNAMIC_VARIANCE: "The policy and live/dynamic quantities differ by at least 20% or two boxes.",
  };
  return messages[reason] ?? reason;
}

export function calculateSuggestion(row: SuggestionRow, now = new Date()): PurchaseOrderSuggestion {
  const minThreshold = Math.max(0, toNumber(row.min_threshold));
  const weeklyTarget = Math.max(0, toNumber(row.weekly_target));
  const rawCurrentQty = Math.max(0, toNumber(row.quantity));
  const ordersPerMonth = toPositiveNumber(row.orders_per_month, ORDERS_PER_MONTH);
  const leadTimeDays = Math.max(0, Math.ceil(toNumber(row.lead_time_days, DEFAULT_LEAD_TIME_DAYS)));
  const reviewDays = TARGET_ORDER_COVERAGE_DAYS;
  // Orders are placed every two weeks. Lead time is a delivery-risk check,
  // not additional consumption coverage on top of the next ordering cycle.
  const horizonDays = reviewDays;
  const testsPerBox = toNumber(row.tests_per_box);
  const avgPatientTests = Math.max(0, toNumber(row.avg_patient_tests_per_month));
  const iqcTests = Math.max(0, toNumber(row.iqc_tests_per_month));
  const theoreticalMonthlyQty = testsPerBox > 0 ? Math.round((avgPatientTests + iqcTests) / testsPerBox) : null;
  const hasDocumentedActualWithdrawal = hasValue(row.documented_actual_withdrawal_boxes);
  const documentedActualWithdrawal = hasDocumentedActualWithdrawal
    ? Math.max(0, toNumber(row.documented_actual_withdrawal_boxes))
    : null;
  const hasApprovedMonthlyTarget = hasValue(row.approved_monthly_target_boxes);
  const approvedMonthlyTarget = Math.max(0, toNumber(row.approved_monthly_target_boxes));
  const hasApprovedOrderQty = hasValue(row.approved_order_qty_boxes);
  const approvedOrderQty = Math.max(0, toNumber(row.approved_order_qty_boxes));
  const dispensedFourteenDays = Math.max(0, toNumber(row.dispensed_14d));
  const observationSpanDays = Math.max(0, Math.min(14, Math.floor(toNumber(row.dispense_observation_days))));
  const observedCalendarDays = Math.max(
    0,
    Math.min(observationSpanDays, Math.floor(toNumber(row.dispense_observed_calendar_days)))
  );
  const futureDispenseLogCount = Math.max(0, Math.floor(toNumber(row.future_dispense_log_count)));
  const liveUsageEligible = observationSpanDays >= LIVE_USAGE_MIN_OBSERVATION_DAYS && dispensedFourteenDays > 0;
  const confidence: SuggestionConfidence = liveUsageEligible ? "high" : observationSpanDays > 0 ? "low" : "none";
  const actualDailyDemand = liveUsageEligible ? dispensedFourteenDays / observationSpanDays : 0;
  const fallbackMonthlyTarget = weeklyTarget * 4;
  const policyMonthlyTarget = hasApprovedMonthlyTarget
    ? approvedMonthlyTarget
    : documentedActualWithdrawal !== null
      ? documentedActualWithdrawal
      : theoreticalMonthlyQty !== null
        ? theoreticalMonthlyQty
        : fallbackMonthlyTarget;
  const monthlyTargetBoxes = liveUsageEligible ? actualDailyDemand * DAYS_PER_MONTH : policyMonthlyTarget;
  const demandSource = liveUsageEligible
    ? "actual_dispense_history"
    : hasApprovedMonthlyTarget
      ? "approved_policy"
      : documentedActualWithdrawal !== null
        ? "documented_withdrawal"
        : theoreticalMonthlyQty !== null
          ? "policy_formula"
          : "weekly_target";
  const dailyDemand = monthlyTargetBoxes / DAYS_PER_MONTH;
  const safetyStockBoxes = Math.max(minThreshold, toNumber(row.safety_stock_boxes, minThreshold));
  const minOrderQtyBoxes = Math.max(1, Math.ceil(toNumber(row.min_order_qty_boxes, 1)));
  const orderMultipleBoxes = Math.max(1, Math.ceil(toNumber(row.order_multiple_boxes, 1)));
  const roundOrderQty = (value: number) =>
    value <= 0 ? 0 : roundUpToMultiple(Math.max(value, minOrderQtyBoxes), orderMultipleBoxes);
  const fallbackPolicyOrderQty = roundOrderQty(policyMonthlyTarget / ordersPerMonth);
  const policyOrderQty = hasApprovedOrderQty ? approvedOrderQty : fallbackPolicyOrderQty;
  const onOrderLots = normalizeOnOrderLots(row.on_order_lots);
  const committedNoEtaQty = Math.max(0, toNumber(row.committed_no_eta_qty));
  const calculationStart = startOfBangkokDate(now);
  const startDateText = dateOnly(calculationStart);
  const sourceInventoryLots = normalizeInventoryLots(row.inventory_lots);
  const horizonEndDateText = dateOnly(addDays(calculationStart, horizonDays));
  const expiredQtyExcluded = sumLots(sourceInventoryLots.filter((lot) => lot.expDate && lot.expDate < startDateText));
  const expiringWithinHorizonLots = sourceInventoryLots.filter((lot) => (
    lot.expDate && lot.expDate >= startDateText && lot.expDate <= horizonEndDateText
  ));
  const nearestExpiryDate = sourceInventoryLots.find((lot) => lot.expDate && lot.expDate >= startDateText)?.expDate ?? null;
  let inventoryLots = sourceInventoryLots.map((lot) => ({ ...lot }));
  if (inventoryLots.length === 0 && rawCurrentQty > 0) {
    inventoryLots = [{ quantity: rawCurrentQty, expDate: null }];
  }
  inventoryLots = inventoryLots.filter((lot) => !lot.expDate || lot.expDate >= startDateText);
  const usableCurrentQty = sumLots(inventoryLots);
  let minimumProjectedBalance = usableCurrentQty;
  let projectedBalanceAtHorizon = usableCurrentQty;
  let unmetDemandThroughLead = 0;
  let unmetDemandThroughHorizon = 0;
  let stockoutDate: string | null = null;

  for (let day = 0; day <= horizonDays; day += 1) {
    const currentDate = addDays(calculationStart, day);
    const currentDateText = dateOnly(currentDate);

    for (const arrival of onOrderLots) {
      if (arrival.etaDate && arrival.etaDate <= currentDateText) {
        inventoryLots.push({ quantity: arrival.quantity, expDate: null });
        arrival.etaDate = null;
      }
    }

    let unmetDemand = 0;
    if (day > 0 && dailyDemand > 0) {
      const consumed = consumeFefo(inventoryLots, dailyDemand, currentDate);
      inventoryLots = consumed.lots;
      unmetDemand = consumed.unmetDemand;
      unmetDemandThroughHorizon += unmetDemand;
      if (day <= leadTimeDays) unmetDemandThroughLead += unmetDemand;
    } else {
      inventoryLots = inventoryLots.filter((lot) => !lot.expDate || lot.expDate >= currentDateText);
    }

    const projectedBalance = sumLots(inventoryLots);
    if (day === horizonDays) projectedBalanceAtHorizon = projectedBalance;
    minimumProjectedBalance = Math.min(minimumProjectedBalance, projectedBalance);
    if (!stockoutDate && ((unmetDemand > 0) || (day === 0 && projectedBalance <= 0 && dailyDemand > 0))) {
      stockoutDate = currentDateText;
    }
  }

  const bridgeRequirementBoxes = unmetDemandThroughLead;
  const endingSafetyGapBoxes = Math.max(0, safetyStockBoxes - projectedBalanceAtHorizon);
  const rawOrderBoxes = unmetDemandThroughHorizon + endingSafetyGapBoxes;
  const dynamicOrderQty = roundOrderQty(rawOrderBoxes);
  const orderRecommended = dynamicOrderQty > 0 || Boolean(stockoutDate);
  const legacySuggestedQty = orderRecommended ? policyOrderQty : 0;
  const varianceAbsQty = Math.abs(dynamicOrderQty - policyOrderQty);
  const variancePercent = policyOrderQty > 0 ? roundToDecimals((varianceAbsQty / policyOrderQty) * 100) : null;
  const varianceRequiresReview = varianceAbsQty >= 2 || (variancePercent !== null && variancePercent >= 20);
  const leadDate = addDays(calculationStart, leadTimeDays);
  const stockoutParsed = parseDateOnly(stockoutDate);
  const expediteRequired = Boolean(stockoutParsed && stockoutParsed < leadDate);
  const verificationStatus = normalizeVerificationStatus(row.source_verification_status);
  const reviewReasons: string[] = [];

  if (observationSpanDays === 0) reviewReasons.push("NO_DISPENSE_HISTORY");
  else if (!liveUsageEligible) reviewReasons.push("INSUFFICIENT_DISPENSE_HISTORY");
  if (futureDispenseLogCount > 0) reviewReasons.push("FUTURE_DISPENSE_LOGS_EXCLUDED");
  if (committedNoEtaQty > 0) reviewReasons.push("OPEN_PURCHASE_ORDER_WITHOUT_ETA");
  if (expediteRequired) reviewReasons.push("STOCKOUT_BEFORE_LEAD_TIME");
  if (verificationStatus === "NEEDS_REVIEW") reviewReasons.push("POLICY_SOURCE_NEEDS_REVIEW");
  if (!hasApprovedOrderQty) reviewReasons.push("MISSING_APPROVED_CYCLE_QTY");
  if (varianceRequiresReview) reviewReasons.push("POLICY_DYNAMIC_VARIANCE");

  const autoSelectable =
    committedNoEtaQty <= 0 &&
    hasApprovedOrderQty &&
    policyOrderQty > 0 &&
    verificationStatus !== "NEEDS_REVIEW";

  return {
    item_id: row.item_id,
    name: row.name,
    unit: row.unit,
    vendor: row.vendor ?? undefined,
    min_threshold: minThreshold,
    weekly_target: weeklyTarget,
    quantity: roundToDecimals(usableCurrentQty),
    suggested_order_qty: legacySuggestedQty,
    system_suggested_order_qty: legacySuggestedQty,
    policy_order_qty: policyOrderQty,
    dynamic_order_qty: dynamicOrderQty,
    theoretical_monthly_qty: theoreticalMonthlyQty,
    documented_actual_withdrawal_boxes: documentedActualWithdrawal,
    variance_abs_qty: varianceAbsQty,
    variance_percent: variancePercent,
    variance_requires_review: varianceRequiresReview,
    confidence,
    data_quality: {
      observation_span_days: observationSpanDays,
      observed_calendar_days: observedCalendarDays,
      future_dispense_log_count: futureDispenseLogCount,
      live_usage_eligible: liveUsageEligible,
    },
    review_reasons: reviewReasons,
    auto_selectable: autoSelectable,
    on_order_qty: onOrderLots.reduce((sum, lot) => sum + lot.quantity, 0),
    committed_no_eta_qty: committedNoEtaQty,
    projected_balance_at_horizon: roundToDecimals(projectedBalanceAtHorizon),
    minimum_projected_balance: roundToDecimals(minimumProjectedBalance),
    safety_stock_boxes: safetyStockBoxes,
    monthly_target_boxes: roundToDecimals(monthlyTargetBoxes),
    planned_order_qty_boxes: policyOrderQty,
    orders_per_month: ordersPerMonth,
    lead_time_days: leadTimeDays,
    review_days: reviewDays,
    horizon_days: horizonDays,
    expedite_required: expediteRequired,
    stockout_date: stockoutDate,
    expiry_assessment: {
      expired_qty_excluded: roundToDecimals(expiredQtyExcluded),
      expiring_within_horizon_qty: roundToDecimals(sumLots(expiringWithinHorizonLots)),
      nearest_expiry_date: nearestExpiryDate,
    },
    calculation_version: CALCULATION_VERSION,
    warnings: reviewReasons.map(warningForReviewReason),
    calculation_breakdown: {
      demandSource,
      dailyDemandBoxes: roundToDecimals(dailyDemand, 3),
      bridgeRequirementBoxes: roundToDecimals(bridgeRequirementBoxes),
      endingSafetyGapBoxes: roundToDecimals(endingSafetyGapBoxes),
      rawOrderBoxes: roundToDecimals(rawOrderBoxes),
      orderMultipleBoxes,
      minOrderQtyBoxes,
    },
  };
}

async function hasPolicyTable(sql: SqlClient) {
  const rows = await sql`SELECT to_regclass('public.reagent_order_policy') AS table_name`;
  return Boolean(rows[0]?.table_name);
}

async function fetchSuggestionRows(
  sql: SqlClient,
  policyTableExists: boolean,
  vendor: string | null,
  keyword: string,
  limit: number
) {
  const searchTerm = `%${keyword}%`;
  const commonCtes = policyTableExists
    ? sql`
      WITH inventory_lots AS (
        SELECT
          item_id,
          jsonb_agg(
            jsonb_build_object('quantity', quantity::numeric, 'exp_date', NULLIF(exp_date::text, '')::date)
            ORDER BY NULLIF(exp_date::text, '')::date ASC NULLS LAST, received_on ASC, id ASC
          ) AS lots,
          COALESCE(SUM(quantity), 0) AS current_qty
        FROM inventory
        WHERE quantity > 0
        GROUP BY item_id
      ),
      on_order AS (
        SELECT
          poi.item_id,
          jsonb_agg(
            jsonb_build_object(
              'quantity', GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0),
              'eta_date', NULLIF(p.expected_date::text, '')::date
            )
            ORDER BY NULLIF(p.expected_date::text, '')::date ASC
          ) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NOT NULL) AS lots,
          COALESCE(
            SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0))
              FILTER (WHERE NULLIF(p.expected_date::text, '') IS NULL),
            0
          ) AS no_eta_qty
        FROM purchase_order_items poi
        JOIN purchase_orders p ON p.id = poi.po_id
        WHERE p.status IN ('SUBMITTED', 'ACKNOWLEDGED', 'REVISION_REQUESTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
          AND GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0) > 0
        GROUP BY poi.item_id
      )
      SELECT
        m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
        COALESCE(i.current_qty, 0) AS quantity,
        p.tests_per_box, p.avg_patient_tests_per_month, p.iqc_tests_per_month,
        p.documented_actual_withdrawal_boxes,
        p.approved_monthly_target_boxes, p.approved_order_qty_boxes, p.orders_per_month,
        p.lead_time_days, p.safety_stock_boxes, p.min_order_qty_boxes, p.order_multiple_boxes,
        p.source_verification_status, p.revision,
        COALESCE(i.lots, '[]'::jsonb) AS inventory_lots,
        COALESCE(o.lots, '[]'::jsonb) AS on_order_lots,
        COALESCE(o.no_eta_qty, 0) AS committed_no_eta_qty
      FROM master_data m
      LEFT JOIN reagent_order_policy p ON p.item_id = m.item_id AND p.enabled = true
      LEFT JOIN inventory_lots i ON i.item_id = m.item_id
      LEFT JOIN on_order o ON o.item_id = m.item_id
      WHERE (${vendor}::text IS NULL OR m.vendor = ${vendor}::text)
        AND (
          ${keyword} = ''
          OR m.item_id ILIKE ${searchTerm}
          OR m.name ILIKE ${searchTerm}
          OR COALESCE(m.barcode, '') ILIKE ${searchTerm}
        )
      ORDER BY COALESCE(i.current_qty, 0), m.name
      LIMIT ${limit}
    `
    : sql`
      WITH inventory_lots AS (
        SELECT
          item_id,
          jsonb_agg(
            jsonb_build_object('quantity', quantity::numeric, 'exp_date', NULLIF(exp_date::text, '')::date)
            ORDER BY NULLIF(exp_date::text, '')::date ASC NULLS LAST, received_on ASC, id ASC
          ) AS lots,
          COALESCE(SUM(quantity), 0) AS current_qty
        FROM inventory
        WHERE quantity > 0
        GROUP BY item_id
      ),
      on_order AS (
        SELECT
          poi.item_id,
          jsonb_agg(
            jsonb_build_object(
              'quantity', GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0),
              'eta_date', NULLIF(p.expected_date::text, '')::date
            )
            ORDER BY NULLIF(p.expected_date::text, '')::date ASC
          ) FILTER (WHERE NULLIF(p.expected_date::text, '') IS NOT NULL) AS lots,
          COALESCE(
            SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0))
              FILTER (WHERE NULLIF(p.expected_date::text, '') IS NULL),
            0
          ) AS no_eta_qty
        FROM purchase_order_items poi
        JOIN purchase_orders p ON p.id = poi.po_id
        WHERE p.status IN ('SUBMITTED', 'ACKNOWLEDGED', 'REVISION_REQUESTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
          AND GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0) > 0
        GROUP BY poi.item_id
      )
      SELECT
        m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
        COALESCE(i.current_qty, 0) AS quantity,
        COALESCE(i.lots, '[]'::jsonb) AS inventory_lots,
        COALESCE(o.lots, '[]'::jsonb) AS on_order_lots,
        COALESCE(o.no_eta_qty, 0) AS committed_no_eta_qty
      FROM master_data m
      LEFT JOIN inventory_lots i ON i.item_id = m.item_id
      LEFT JOIN on_order o ON o.item_id = m.item_id
      WHERE (${vendor}::text IS NULL OR m.vendor = ${vendor}::text)
        AND (
          ${keyword} = ''
          OR m.item_id ILIKE ${searchTerm}
          OR m.name ILIKE ${searchTerm}
          OR COALESCE(m.barcode, '') ILIKE ${searchTerm}
        )
      ORDER BY COALESCE(i.current_qty, 0), m.name
      LIMIT ${limit}
    `;

  return commonCtes;
}

async function fetchDispenseUsage(sql: SqlClient) {
  return sql`
    WITH bangkok_clock AS (
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE ${BANGKOK_TIME_ZONE})::date AS today_bangkok
    ),
    eligible_logs AS (
      SELECT
        l.item_id,
        l.quantity,
        (l.timestamp AT TIME ZONE ${BANGKOK_TIME_ZONE})::date AS dispense_date,
        c.today_bangkok
      FROM logs l
      JOIN master_data m ON m.item_id = l.item_id
      CROSS JOIN bangkok_clock c
      WHERE l.action = ${DISPENSE_ACTION}
        AND l.quantity > 0
        AND l.timestamp IS NOT NULL
    )
    SELECT
      item_id,
      COALESCE(
        SUM(quantity) FILTER (
          WHERE dispense_date BETWEEN today_bangkok - 13 AND today_bangkok
        ),
        0
      ) AS dispensed_14d,
      COALESCE(
        MAX(dispense_date) FILTER (
          WHERE dispense_date BETWEEN today_bangkok - 13 AND today_bangkok
        ) - MIN(dispense_date) FILTER (
          WHERE dispense_date BETWEEN today_bangkok - 13 AND today_bangkok
        ) + 1,
        0
      ) AS dispense_observation_days,
      COUNT(DISTINCT dispense_date) FILTER (
        WHERE dispense_date BETWEEN today_bangkok - 13 AND today_bangkok
      ) AS dispense_observed_calendar_days,
      COUNT(*) FILTER (WHERE dispense_date > today_bangkok) AS future_dispense_log_count
    FROM eligible_logs
    WHERE dispense_date >= today_bangkok - 13 OR dispense_date > today_bangkok
    GROUP BY item_id
  `;
}

export async function getPurchaseOrderSuggestions(sql: SqlClient, options: FetchSuggestionOptions = {}) {
  const policyTableExists = await hasPolicyTable(sql);
  const vendor = options.vendor?.trim() || null;
  const keyword = options.keyword?.trim() || "";
  const limit = Math.max(1, Math.min(100, options.limit ?? 100));
  const [rows, usageRows] = await Promise.all([
    fetchSuggestionRows(sql, policyTableExists, vendor, keyword, limit),
    fetchDispenseUsage(sql),
  ]);
  const usageByItemId = new Map(
    usageRows.map((usage) => [String(usage.item_id), usage] as const)
  );

  return (rows as SuggestionRow[])
    .map((row) => calculateSuggestion({ ...row, ...(usageByItemId.get(row.item_id) ?? {}) }))
    .filter(
      (item) =>
        options.includeAll ||
        item.suggested_order_qty > 0 ||
        item.dynamic_order_qty > 0 ||
        item.expedite_required
    );
}
