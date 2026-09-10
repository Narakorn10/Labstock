import { describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ default: vi.fn() }));
import { calculateSuggestion } from "./purchase-order-suggestions";
import {
  buildAuditedPurchaseOrderItem,
  PurchaseOrderCreationError,
} from "./purchase-order-creation";

function suggestion(overrides: Record<string, unknown> = {}) {
  return calculateSuggestion({
    item_id: "CHEM-R-001",
    name: "Glucose",
    unit: "box",
    vendor: "Vendor A",
    min_threshold: 0,
    weekly_target: 0,
    quantity: 0,
    approved_monthly_target_boxes: 30,
    approved_order_qty_boxes: 15,
    orders_per_month: 2,
    lead_time_days: 7,
    safety_stock_boxes: 0,
    min_order_qty_boxes: 1,
    order_multiple_boxes: 1,
    source_verification_status: "VERIFIED",
    inventory_lots: [],
    on_order_lots: [],
    dispensed_14d: 0,
    dispense_observation_days: 0,
    ...overrides,
  }, new Date("2026-08-10T00:00:00.000Z"));
}

describe("server-authoritative purchase-order item audit", () => {
  it("stores the server dynamic quantity and ignores client calculation snapshots", () => {
    const current = suggestion();
    const result = buildAuditedPurchaseOrderItem({
      item_id: current.item_id,
      item_name: "client name is ignored",
      quantity: current.policy_order_qty,
      unit: "client unit",
      selected_basis: "POLICY",
    }, current, "LAB", "2026-08-10T10:00:00.000Z");

    expect(result.item_name).toBe("Glucose");
    expect(result.unit).toBe("box");
    expect(result.system_suggested_qty).toBe(current.dynamic_order_qty);
    expect(result.selected_basis).toBe("POLICY");
    expect(result.calculation_snapshot.calculated_at).toBe("2026-08-10T10:00:00.000Z");
  });

  it("requires a reason when a Lab user overrides the recomputed quantities", () => {
    const current = suggestion();
    expect(() => buildAuditedPurchaseOrderItem({
      item_id: current.item_id,
      item_name: current.name,
      quantity: current.policy_order_qty + 1,
      unit: current.unit,
      selected_basis: "MANUAL",
    }, current, "LAB")).toThrow(PurchaseOrderCreationError);
  });

  it("allows an unchanged policy quantity for a pending PO without ETA", () => {
    const current = suggestion({ committed_no_eta_qty: 10 });
    expect(current.auto_selectable).toBe(false);

    const result = buildAuditedPurchaseOrderItem({
      item_id: current.item_id,
      item_name: current.name,
      quantity: current.policy_order_qty,
      unit: current.unit,
      selected_basis: "POLICY",
    }, current, "LAB");

    expect(result.selected_basis).toBe("POLICY");
    expect(result.override_reason).toBeNull();
  });

  it("keeps legacy Vendor proposals compatible without forcing a Lab override reason", () => {
    const current = suggestion();
    const result = buildAuditedPurchaseOrderItem({
      item_id: current.item_id,
      item_name: current.name,
      quantity: current.policy_order_qty + 1,
      unit: current.unit,
    }, current, "VENDOR");
    expect(result.selected_basis).toBe("MANUAL");
    expect(result.override_reason).toBeNull();
  });
});
