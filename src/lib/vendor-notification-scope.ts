/**
 * Vendors must only ever be told about their own products. These pure helpers
 * split notification recipients into staff (see everything) and vendors (see
 * only items whose master_data.vendor matches theirs). They fail closed: a
 * Vendor account with no vendor name receives nothing.
 */

export interface ScopedRecipientRow {
  role?: unknown;
  vendor?: unknown;
}

export function splitRecipientsByVendor<T extends ScopedRecipientRow>(rows: T[]) {
  const staff: T[] = [];
  const vendors: Array<{ vendor: string; row: T }> = [];
  for (const row of rows) {
    if (row.role !== "Vendor") {
      staff.push(row);
      continue;
    }
    const vendor = String(row.vendor ?? "").trim();
    if (vendor) vendors.push({ vendor, row });
  }
  return { staff, vendors };
}

export function itemsForVendor<T extends { vendor?: string | null }>(items: T[], vendor: string): T[] {
  const wanted = vendor.trim();
  if (!wanted) return [];
  return items.filter((item) => (item.vendor ?? "").trim() === wanted);
}
