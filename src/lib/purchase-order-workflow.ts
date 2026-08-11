export const purchaseOrderStatuses = [
  "PENDING_MANAGER_REVIEW",
  "PENDING_LAB_REVIEW",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "REVISION_REQUESTED",
  "CONFIRMED",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "EXPIRED",
  "REJECTED",
] as const;

export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];
export type PurchaseOrderOrigin = "LAB" | "VENDOR";
export type PurchaseOrderAction =
  | "UPDATE_UNACKNOWLEDGED_LAB_ORDER"
  | "APPROVE_MANAGER_REVIEW"
  | "REJECT_MANAGER_REVIEW"
  | "ACKNOWLEDGE"
  | "CONFIRM_AVAILABILITY"
  | "REQUEST_REVISION"
  | "REJECT"
  | "APPROVE_REVISION"
  | "REJECT_REVISION";

export type PurchaseOrderItemInput = {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  selected_basis?: "POLICY" | "DYNAMIC" | "MANUAL";
  override_reason?: string;
};

export function isLabPurchasingRole(role: string) {
  return role === "Admin" || role === "Manager";
}

export function validatePurchaseOrderItems(items: unknown): PurchaseOrderItemInput[] | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  const hasInvalidAuditMetadata = items.some((item) => {
    const row = item as Partial<PurchaseOrderItemInput>;
    const basis = String(row.selected_basis ?? "").trim().toUpperCase();
    const reason = String(row.override_reason ?? "").trim();
    return (basis && basis !== "POLICY" && basis !== "DYNAMIC" && basis !== "MANUAL") || reason.length > 500;
  });
  if (hasInvalidAuditMetadata) return null;

  const normalized = items.map((item) => {
    const row = item as Partial<PurchaseOrderItemInput>;
    const selectedBasis = String(row.selected_basis ?? "").trim().toUpperCase();
    const normalizedBasis: PurchaseOrderItemInput["selected_basis"] =
      selectedBasis === "POLICY" || selectedBasis === "DYNAMIC" || selectedBasis === "MANUAL"
        ? selectedBasis
        : undefined;
    return {
      item_id: String(row.item_id ?? "").trim(),
      item_name: String(row.item_name ?? "").trim(),
      quantity: Number(row.quantity),
      unit: String(row.unit ?? "").trim(),
      selected_basis: normalizedBasis,
      override_reason: String(row.override_reason ?? "").trim() || undefined,
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
