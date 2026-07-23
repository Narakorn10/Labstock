export const purchaseOrderStatuses = [
  "PENDING_LAB_REVIEW",
  "SUBMITTED",
  "REVISION_REQUESTED",
  "CONFIRMED",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "REJECTED",
] as const;

export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];
export type PurchaseOrderOrigin = "LAB" | "VENDOR";

export type PurchaseOrderItemInput = {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
};

export function isLabPurchasingRole(role: string) {
  return role === "Admin" || role === "Manager";
}

export function validatePurchaseOrderItems(items: unknown): PurchaseOrderItemInput[] | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  const normalized = items.map((item) => {
    const row = item as Partial<PurchaseOrderItemInput>;
    return {
      item_id: String(row.item_id ?? "").trim(),
      item_name: String(row.item_name ?? "").trim(),
      quantity: Number(row.quantity),
      unit: String(row.unit ?? "").trim(),
    };
  });

  if (normalized.some((item) => !item.item_id || !item.item_name || !item.unit || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
    return null;
  }

  if (new Set(normalized.map((item) => item.item_id)).size !== normalized.length) {
    return null;
  }

  return normalized;
}
