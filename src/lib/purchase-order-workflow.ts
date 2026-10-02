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
  "CANCELLED",
  "CLOSED_SHORT",
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
  | "REJECT_REVISION"
  | "CANCEL"
  | "CLOSE_SHORT";

export type PurchaseOrderItemInput = {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  selected_basis?: "POLICY" | "DYNAMIC" | "MANUAL";
  override_reason?: string;
};

/** Sent to the Vendor but nothing shipped or accepted yet. Before that, use REJECT_MANAGER_REVIEW. */
export const CANCELLABLE_STATUSES: readonly string[] = ["SUBMITTED", "ACKNOWLEDGED", "REVISION_REQUESTED", "CONFIRMED"];
/**
 * Statuses in which the Lab can confirm that ordered lines arrived. Includes orders the Vendor
 * never acknowledged, because Vendors often do not use the portal at all.
 */
export const LAB_RECEIPT_STATUSES: readonly string[] = [
  "SUBMITTED", "ACKNOWLEDGED", "CONFIRMED", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_RECEIVED",
];
/** Part of the order was accepted and the Lab will not wait for the rest. */
export const CLOSE_SHORT_STATUSES: readonly string[] = ["PARTIALLY_RECEIVED"];

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

/** Explains, in Thai, why validatePurchaseOrderItems rejected the items (for the user, not a code). */
export function describeInvalidPurchaseOrderItems(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return "กรุณาเลือกน้ำยาอย่างน้อย 1 รายการ";

  const rows = items.map((item) => item as Partial<PurchaseOrderItemInput>);
  const label = (row: Partial<PurchaseOrderItemInput>) => String(row.item_name || row.item_id || "").trim() || "รายการที่ยังไม่ได้เลือกน้ำยา";

  const unselected = rows.find((row) => !String(row.item_id ?? "").trim());
  if (unselected) return `${label(unselected)}: กรุณาเลือกน้ำยาจากรายการ`;

  const seen = new Set<string>();
  const duplicate = rows.find((row) => {
    const id = String(row.item_id ?? "").trim();
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  if (duplicate) return `น้ำยาซ้ำ: ${label(duplicate)} มีอยู่ในใบสั่งแล้ว กรุณารวมจำนวนเป็นรายการเดียว`;

  const badQuantity = rows.find((row) => !Number.isInteger(Number(row.quantity)) || Number(row.quantity) <= 0);
  if (badQuantity) return `${label(badQuantity)}: จำนวนต้องเป็นจำนวนเต็มมากกว่า 0`;

  const longReason = rows.find((row) => String(row.override_reason ?? "").trim().length > 500);
  if (longReason) return `${label(longReason)}: เหตุผลยาวเกิน 500 ตัวอักษร`;

  return "ข้อมูลรายการน้ำยาไม่ครบ (ชื่อ หน่วย หรือจำนวน)";
}
