import { describe, expect, it } from "vitest";
import { buildAiReviewerPayload, parseAiReviews } from "./purchase-order-ai-review";
import type { PurchaseOrderSuggestion } from "./purchase-order-suggestions";

const suggestion = {
  item_id: "R-1", name: "น้ำยา A", unit: "box", quantity: 2, policy_order_qty: 3, dynamic_order_qty: 4,
  projected_balance_at_horizon: -1, safety_stock_boxes: 1, lead_time_days: 5, horizon_days: 14, overdue_on_order_qty: 0,
  review_reasons: ["STOCKOUT_BEFORE_LEAD_TIME"], expedite_required: true,
  expiry_assessment: { expired_qty_excluded: 0, expiring_within_horizon_qty: 1, nearest_expiry_date: "2026-10-01" },
  calculation_breakdown: { dailyDemandBoxes: 0.5 }, vendor: "Must not leave server", suggested_order_qty: 3,
} as unknown as PurchaseOrderSuggestion;

describe("purchase-order AI reviewer privacy and output gate", () => {
  it("uses an explicit sanitized payload whitelist", () => {
    const payload = buildAiReviewerPayload([suggestion]);
    expect(payload[0]).not.toHaveProperty("vendor");
    expect(JSON.stringify(payload)).not.toContain("Must not leave server");
    expect(payload[0]).not.toHaveProperty("logs");
    expect(payload[0].item_id).toBe("R-1");
  });

  it("accepts only valid reviews for supplied items", () => {
    expect(parseAiReviews({ reviews: [{ item_id: "R-1", priority: "HIGH", explanation_th: "มีความเสี่ยงขาดสต็อก", evidence: ["คงเหลือ 2"], review_questions: ["ตรวจสอบกำหนดส่ง"] }] }, new Set(["R-1"]))).not.toBeNull();
    expect(parseAiReviews({ reviews: [{ item_id: "OTHER", priority: "HIGH", explanation_th: "x", evidence: [], review_questions: [] }] }, new Set(["R-1"]))).toBeNull();
  });
});
