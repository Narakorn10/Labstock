import { describe, expect, it } from "vitest";
import {
  isLabPurchasingRole,
  validatePurchaseOrderItems,
} from "./purchase-order-workflow";

const legacyItem = {
  item_id: "GLUCOSE",
  item_name: "Glucose reagent",
  quantity: 2,
  unit: "box",
};

describe("purchase-order authorization and item validation", () => {
  it("keeps legacy desktop and LIFF payloads backward compatible", () => {
    expect(validatePurchaseOrderItems([legacyItem])).toEqual([
      {
        ...legacyItem,
        selected_basis: undefined,
        override_reason: undefined,
      },
    ]);
  });

  it("normalizes an accepted basis and keeps its override reason", () => {
    expect(validatePurchaseOrderItems([{
      ...legacyItem,
      selected_basis: "dynamic",
      override_reason: "ใช้ยอดเบิกจริงที่สูงขึ้น",
    }])).toEqual([{
      ...legacyItem,
      selected_basis: "DYNAMIC",
      override_reason: "ใช้ยอดเบิกจริงที่สูงขึ้น",
    }]);
  });

  it.each(["POLICY", "DYNAMIC", "MANUAL"])("accepts %s as a selected basis", (selectedBasis) => {
    expect(validatePurchaseOrderItems([{ ...legacyItem, selected_basis: selectedBasis }])).not.toBeNull();
  });

  it("rejects an unknown selected basis", () => {
    expect(validatePurchaseOrderItems([{ ...legacyItem, selected_basis: "AUTO" }])).toBeNull();
  });

  it("rejects an overlong override reason", () => {
    expect(validatePurchaseOrderItems([{ ...legacyItem, override_reason: "x".repeat(501) }])).toBeNull();
  });

  it.each([
    { quantity: 0 },
    { quantity: -1 },
    { quantity: 1.5 },
    { item_id: "" },
    { item_name: "" },
    { unit: "" },
  ])("rejects malformed item data: %j", (override) => {
    expect(validatePurchaseOrderItems([{ ...legacyItem, ...override }])).toBeNull();
  });

  it("rejects duplicate item IDs in a single purchase order", () => {
    expect(validatePurchaseOrderItems([legacyItem, { ...legacyItem, item_name: "same reagent" }])).toBeNull();
  });

  it("rejects an empty or non-array item list", () => {
    expect(validatePurchaseOrderItems([])).toBeNull();
    expect(validatePurchaseOrderItems(null)).toBeNull();
    expect(validatePurchaseOrderItems({ items: [legacyItem] })).toBeNull();
  });

  it("allows only lab purchasing roles to create lab orders", () => {
    expect(isLabPurchasingRole("Admin")).toBe(true);
    expect(isLabPurchasingRole("Manager")).toBe(true);
    expect(isLabPurchasingRole("Vendor")).toBe(false);
    expect(isLabPurchasingRole("Technician")).toBe(false);
    expect(isLabPurchasingRole("admin")).toBe(false);
  });
});
