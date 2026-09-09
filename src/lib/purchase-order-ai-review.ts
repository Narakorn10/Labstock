import crypto from "crypto";
import type { PurchaseOrderSuggestion } from "@/lib/purchase-order-suggestions";

export const aiReviewPriorities = ["CRITICAL", "HIGH", "NORMAL", "LOW"] as const;
export type AiReviewPriority = (typeof aiReviewPriorities)[number];

export type AiReviewerItem = {
  item_id: string;
  item_name: string;
  current_stock: number;
  unit: string;
  daily_demand: number;
  policy_order_qty: number;
  dynamic_order_qty: number;
  projected_balance_at_horizon: number;
  safety_stock: number;
  lead_time_days: number;
  horizon_days: number;
  overdue_on_order_qty: number;
  review_reasons: string[];
  expedite_required: boolean;
  expiry: PurchaseOrderSuggestion["expiry_assessment"];
};

export type AiReview = {
  item_id: string;
  priority: AiReviewPriority;
  explanation_th: string;
  evidence: string[];
  review_questions: string[];
};

const MAX_TEXT_LENGTH = 900;
const MAX_LIST_LENGTH = 6;

/** This is deliberately a whitelist, so vendor, staff data, logs, and raw lots never leave the server. */
export function buildAiReviewerPayload(suggestions: PurchaseOrderSuggestion[]): AiReviewerItem[] {
  return suggestions.map((item) => ({
    item_id: item.item_id,
    item_name: item.name,
    current_stock: item.quantity,
    unit: item.unit,
    daily_demand: item.calculation_breakdown.dailyDemandBoxes,
    policy_order_qty: item.policy_order_qty,
    dynamic_order_qty: item.dynamic_order_qty,
    projected_balance_at_horizon: item.projected_balance_at_horizon,
    safety_stock: item.safety_stock_boxes,
    lead_time_days: item.lead_time_days,
    horizon_days: item.horizon_days,
    overdue_on_order_qty: item.overdue_on_order_qty,
    review_reasons: item.review_reasons,
    expedite_required: item.expedite_required,
    expiry: item.expiry_assessment,
  }));
}

export function fingerprintAiReviewerPayload(payload: AiReviewerItem[]) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function validText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function validTextList(value: unknown) {
  return Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(validText);
}

/** Validate even structured-model output before any response is displayed or persisted. */
export function parseAiReviews(value: unknown, allowedItemIds: Set<string>): AiReview[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { reviews?: unknown }).reviews)) return null;
  const seen = new Set<string>();
  const reviews: AiReview[] = [];
  for (const row of (value as { reviews: unknown[] }).reviews) {
    if (!row || typeof row !== "object") return null;
    const review = row as Record<string, unknown>;
    const itemId = review.item_id;
    if (typeof itemId !== "string" || !allowedItemIds.has(itemId) || seen.has(itemId)) return null;
    if (!aiReviewPriorities.includes(review.priority as AiReviewPriority) || !validText(review.explanation_th)
      || !validTextList(review.evidence) || !validTextList(review.review_questions)) return null;
    seen.add(itemId);
    reviews.push({
      item_id: itemId,
      priority: review.priority as AiReviewPriority,
      explanation_th: (review.explanation_th as string).trim(),
      evidence: (review.evidence as string[]).map((entry) => entry.trim()),
      review_questions: (review.review_questions as string[]).map((entry) => entry.trim()),
    });
  }
  return reviews;
}

export const aiReviewerResponseSchema = {
  type: "object",
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_id: { type: "string" },
          priority: { type: "string", enum: [...aiReviewPriorities] },
          explanation_th: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          review_questions: { type: "array", items: { type: "string" } },
        },
        required: ["item_id", "priority", "explanation_th", "evidence", "review_questions"],
      },
    },
  },
  required: ["reviews"],
} as const;
