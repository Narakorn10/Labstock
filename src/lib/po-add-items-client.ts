// Pure helpers of the "เพิ่มรายการน้ำยา" dialog (src/components/po-add-items-dialog.tsx), kept apart so they can be tested.

export type NewLine = { item_id: string; item_name: string; unit: string; quantity: string; reason: string };

/** A line is complete with a whole quantity of at least 1 and a documented reason. */
export function isLineComplete(line: NewLine): boolean {
  return /^[1-9]\d{0,8}$/.test(line.quantity.trim()) && line.reason.trim().length > 0;
}

export function canSubmitLines(lines: NewLine[]): boolean {
  return lines.length > 0 && lines.every(isLineComplete) && new Set(lines.map((line) => line.item_id)).size === lines.length;
}

/** The PATCH body. Every line is a manual quantity with its reason; the server takes name and unit from its own data. */
export function buildAddItemsBody(lines: NewLine[]) {
  return {
    action: "ADD_ITEMS_TO_MANAGER_REVIEW" as const,
    items: lines.map((line) => ({
      item_id: line.item_id,
      item_name: line.item_name,
      unit: line.unit,
      quantity: Number(line.quantity.trim()),
      selected_basis: "MANUAL" as const,
      override_reason: line.reason.trim(),
    })),
  };
}
