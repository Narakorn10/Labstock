import { describe, expect, it } from "vitest";
import { calculateSuggestion } from "./purchase-order-suggestions";

const NOW = new Date("2026-08-10T00:00:00.000Z");

type SuggestionV5 = {
  policy_order_qty: number;
  dynamic_order_qty: number;
  theoretical_monthly_qty: number;
  variance_abs_qty: number;
  variance_percent: number;
  confidence: unknown;
  data_quality: unknown;
  review_reasons: unknown;
  auto_selectable: boolean;
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    item_id: "GLUCOSE",
    name: "Glucose",
    unit: "box",
    vendor: "Test vendor",
    min_threshold: 0,
    weekly_target: 0,
    quantity: 0,
    tests_per_box: 100,
    avg_patient_tests_per_month: 100,
    iqc_tests_per_month: 0,
    approved_monthly_target_boxes: 5,
    approved_order_qty_boxes: 3,
    approved_cycle_qty_boxes: 3,
    orders_per_month: 2,
    lead_time_days: 7,
    safety_stock_boxes: 0,
    min_order_qty_boxes: 1,
    order_multiple_boxes: 1,
    inventory_lots: [],
    on_order_lots: [],
    committed_no_eta_qty: 0,
    dispensed_14d: 0,
    dispense_observation_days: 14,
    ...overrides,
  } as Parameters<typeof calculateSuggestion>[0];
}

function fields(result: unknown) {
  return result as SuggestionV5;
}

function reasonText(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).map(String);
  return [];
}

function hasReason(result: unknown, pattern: RegExp) {
  return reasonText(fields(result).review_reasons).some((reason) => pattern.test(reason));
}

describe("calculateSuggestion v5 policy and live-demand contract", () => {
  it.each([
    ["GLUCOSE", 100, 100, 360, 5],
    ["BUN", 100, 200, 180, 4],
    ["CREATININE", 100, 100, 48, 1],
  ])("rounds the theoretical formula for %s", (itemId, testsPerBox, average, iqc, expected) => {
    const result = calculateSuggestion(makeRow({
      item_id: itemId,
      tests_per_box: testsPerBox,
      avg_patient_tests_per_month: average,
      iqc_tests_per_month: iqc,
    }), NOW);

    expect(fields(result).theoretical_monthly_qty).toBe(expected);
  });

  it.each([
    ["CO2", 25, 15],
    ["MG", 15, 7],
  ])("preserves the manual monthly and per-cycle policy for %s", (itemId, monthly, cycle) => {
    const result = calculateSuggestion(makeRow({
      item_id: itemId,
      name: itemId,
      approved_monthly_target_boxes: monthly,
      approved_order_qty_boxes: cycle,
      approved_cycle_qty_boxes: cycle,
      tests_per_box: 100,
      avg_patient_tests_per_month: 100,
      iqc_tests_per_month: 48,
    }), NOW);
    const v5 = fields(result);

    expect(result.monthly_target_boxes).toBe(monthly);
    expect(result.planned_order_qty_boxes).toBe(cycle);
    expect(v5.policy_order_qty).toBe(cycle);
    expect(result.orders_per_month).toBe(2);
  });

  it("uses the item-specific IQC input in the theoretical formula", () => {
    const rows = [360, 180, 48].map((iqc) => makeRow({
      item_id: `IQC-${iqc}`,
      tests_per_box: 100,
      avg_patient_tests_per_month: 100,
      iqc_tests_per_month: iqc,
    }));

    expect(rows.map((row) => fields(calculateSuggestion(row, NOW)).theoretical_monthly_qty)).toEqual([5, 3, 1]);
  });

  it("keeps a manual policy usable when formula inputs are not yet supplied", () => {
    const result = calculateSuggestion(makeRow({
      tests_per_box: 0,
      avg_patient_tests_per_month: 0,
      iqc_tests_per_month: 0,
      approved_monthly_target_boxes: 15,
      approved_order_qty_boxes: 7,
      approved_cycle_qty_boxes: 7,
      weekly_target: 0,
    }), NOW);
    const v5 = fields(result);

    expect(v5.theoretical_monthly_qty).toBeNull();
    expect(v5.policy_order_qty).toBe(7);
    expect(result.monthly_target_boxes).toBe(15);
    expect(result.planned_order_qty_boxes).toBe(7);
  });

  it("does not alias ISE consumables to virtual sodium, potassium, or chloride rows", () => {
    const itemIds = ["ISE BUFFER", "ISE REFERENCE", "ISE MID STANDARD", "SODIUM", "POTASSIUM", "CHLORIDE"];
    const results = itemIds.map((itemId) => calculateSuggestion(makeRow({
      item_id: itemId,
      name: itemId,
      approved_monthly_target_boxes: 2,
      approved_order_qty_boxes: 1,
      approved_cycle_qty_boxes: 1,
    }), NOW));

    expect(results.map((result) => result.item_id)).toEqual(itemIds);
    expect(new Set(results.map((result) => result.item_id)).size).toBe(itemIds.length);
  });

  it("uses live dispense history when the observation span is at least seven days", () => {
    const result = calculateSuggestion(makeRow({
      dispensed_14d: 14,
      dispense_observation_days: 14,
      approved_monthly_target_boxes: 20,
      approved_order_qty_boxes: 10,
    }), NOW);
    const v5 = fields(result);

    expect(result.calculation_breakdown.demandSource).toBe("actual_dispense_history");
    expect(v5.confidence).toEqual(expect.stringMatching(/high|sufficient/i));
    expect(result.monthly_target_boxes).toBe(30);
    expect(v5.data_quality).toBeDefined();
  });

  it("falls back to the approved policy for a short observation span", () => {
    const result = calculateSuggestion(makeRow({
      dispensed_14d: 6,
      dispense_observation_days: 6,
      approved_monthly_target_boxes: 20,
      approved_order_qty_boxes: 10,
    }), NOW);
    const v5 = fields(result);

    expect(result.calculation_breakdown.demandSource).toBe("approved_policy");
    expect(result.monthly_target_boxes).toBe(20);
    expect(v5.confidence).toEqual(expect.stringMatching(/low|insufficient/i));
    expect(
      hasReason(result, /history|observation|confidence|7|ข้อมูล/i)
      || reasonText(v5.data_quality).some((reason) => /history|observation|confidence|7|ข้อมูล/i.test(reason)),
    ).toBe(true);
  });

  it("uses approved policy projection when there is no dispense history", () => {
    const result = calculateSuggestion(makeRow({
      dispensed_14d: 0,
      dispense_observation_days: 0,
      approved_monthly_target_boxes: 12,
      approved_order_qty_boxes: 6,
    }), NOW);
    const v5 = fields(result);

    expect(result.calculation_breakdown.demandSource).toBe("approved_policy");
    expect(result.monthly_target_boxes).toBe(12);
    expect(v5.data_quality).toBeDefined();
    expect(
      hasReason(result, /history|dispense|usage|เบิก|ข้อมูล/i)
      || reasonText(v5.data_quality).some((reason) => /history|dispense|usage|เบิก|ข้อมูล/i.test(reason)),
    ).toBe(true);
  });

  it("uses FEFO and ignores already-expired lots", () => {
    const result = calculateSuggestion(makeRow({
      approved_monthly_target_boxes: 15,
      approved_order_qty_boxes: 7,
      inventory_lots: [
        { quantity: 100, exp_date: "2026-08-09" },
        { quantity: 2, exp_date: "2026-08-11" },
        { quantity: 11, exp_date: "2026-09-01" },
      ],
    }), NOW);

    expect(result.projected_balance_at_horizon).toBeGreaterThan(0);
    expect(result.projected_balance_at_horizon).toBeLessThan(10);
    expect(result.stockout_date).toBeNull();
  });

  it("counts an on-order lot with ETA in the projection", () => {
    const result = calculateSuggestion(makeRow({
      approved_monthly_target_boxes: 3,
      approved_order_qty_boxes: 2,
      inventory_lots: [{ quantity: 1, exp_date: "2026-12-31" }],
      on_order_lots: [{ quantity: 3, eta_date: "2026-08-12" }],
    }), NOW);

    expect(result.on_order_qty).toBe(3);
    expect(fields(result).dynamic_order_qty).toBe(0);
    expect(result.stockout_date).toBeNull();
  });

  it("flags an open purchase order without ETA for manual review and excludes it from auto-selection", () => {
    const result = calculateSuggestion(makeRow({
      approved_monthly_target_boxes: 3,
      approved_order_qty_boxes: 2,
      inventory_lots: [{ quantity: 3, exp_date: "2026-12-31" }],
      committed_no_eta_qty: 10,
    }), NOW);

    expect(fields(result).auto_selectable).toBe(false);
    expect(hasReason(result, /eta|กำหนดส่ง|manual|ทบทวน/i)).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/ETA/i);
  });

  it("does not order when non-expired stock covers the next cycle and lead-time horizon", () => {
    const result = calculateSuggestion(makeRow({
      approved_monthly_target_boxes: 30,
      approved_order_qty_boxes: 15,
      inventory_lots: [{ quantity: 50, exp_date: "2026-12-31" }],
    }), NOW);

    expect(fields(result).dynamic_order_qty).toBe(0);
    expect(result.suggested_order_qty).toBe(0);
  });

  it("marks a stockout before lead time as urgent", () => {
    const result = calculateSuggestion(makeRow({
      approved_monthly_target_boxes: 30,
      approved_order_qty_boxes: 15,
      inventory_lots: [{ quantity: 1, exp_date: "2026-12-31" }],
    }), NOW);

    expect(result.expedite_required).toBe(true);
    expect(fields(result).auto_selectable).toBe(true);
    expect(result.stockout_date).not.toBeNull();
    expect(hasReason(result, /lead|stockout|ขาด|เร่ง/i)).toBe(true);
  });

  it("rounds a dynamic result up to both the minimum and order multiple", () => {
    const result = calculateSuggestion(makeRow({
      approved_monthly_target_boxes: 2,
      approved_order_qty_boxes: 2,
      safety_stock_boxes: 2,
      min_order_qty_boxes: 4,
      order_multiple_boxes: 3,
      inventory_lots: [{ quantity: 1, exp_date: "2026-12-31" }],
    }), NOW);

    expect(fields(result).dynamic_order_qty).toBe(6);
    expect(fields(result).dynamic_order_qty % 3).toBe(0);
    expect(fields(result).dynamic_order_qty).toBeGreaterThanOrEqual(4);
  });

  it("reports the approved-vs-live variance and requests review at two boxes or twenty percent", () => {
    const result = calculateSuggestion(makeRow({
      approved_monthly_target_boxes: 30,
      approved_order_qty_boxes: 15,
      dispensed_14d: 56,
      dispense_observation_days: 14,
      inventory_lots: [],
    }), NOW);
    const v5 = fields(result);

    expect(v5.dynamic_order_qty).toBeGreaterThan(v5.policy_order_qty);
    expect(v5.variance_abs_qty).toBeGreaterThanOrEqual(2);
    const variancePercent = v5.variance_percent <= 1 ? v5.variance_percent * 100 : v5.variance_percent;
    expect(variancePercent).toBeGreaterThanOrEqual(20);
    expect(hasReason(result, /variance|approved|policy|ทบทวน|ต่าง/i)).toBe(true);
  });

  it("requests review when the absolute difference is two boxes even below twenty percent", () => {
    const result = calculateSuggestion(makeRow({
      approved_monthly_target_boxes: 30,
      approved_order_qty_boxes: 20,
      inventory_lots: [],
    }), NOW);
    const v5 = fields(result);
    expect(v5.dynamic_order_qty).toBe(22);
    expect(v5.variance_abs_qty).toBe(2);
    expect(v5.variance_percent).toBe(10);
    expect(hasReason(result, /POLICY_DYNAMIC_VARIANCE|variance|ทบทวน/i)).toBe(true);
  });

  it("requests review at twenty percent even when the difference is only one box", () => {
    const result = calculateSuggestion(makeRow({
      approved_monthly_target_boxes: 7.5,
      approved_order_qty_boxes: 5,
      inventory_lots: [],
    }), NOW);
    const v5 = fields(result);
    expect(v5.dynamic_order_qty).toBe(6);
    expect(v5.variance_abs_qty).toBe(1);
    expect(v5.variance_percent).toBe(20);
    expect(hasReason(result, /POLICY_DYNAMIC_VARIANCE|variance|ทบทวน/i)).toBe(true);
  });

  it("surfaces excluded future-dated logs as a data-quality warning", () => {
    const result = calculateSuggestion(makeRow({
      future_dispense_log_count: 3,
      dispensed_14d: 14,
      dispense_observation_days: 14,
    }), NOW);
    expect(fields(result).data_quality).toMatchObject({ future_dispense_log_count: 3 });
    expect(hasReason(result, /FUTURE_DISPENSE_LOGS_EXCLUDED|future/i)).toBe(true);
  });

  it("uses Bangkok calendar dates at the UTC day boundary", () => {
    const row = makeRow({
      approved_monthly_target_boxes: 30,
      approved_order_qty_boxes: 15,
      inventory_lots: [],
    });

    const beforeMidnight = calculateSuggestion(row, new Date("2026-08-10T16:59:59.000Z"));
    const afterMidnight = calculateSuggestion(row, new Date("2026-08-10T17:00:00.000Z"));

    expect(beforeMidnight.stockout_date).toBe("2026-08-10");
    expect(afterMidnight.stockout_date).toBe("2026-08-11");
  });
});
