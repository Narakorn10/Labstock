import type sqlClient from "./db";
import { PO_HAS_IN_TRANSIT, runGuardedPurchaseOrderUpdate } from "./purchase-order-review";
import { recomputePurchaseOrderStatusQuery } from "./purchase-order-status";

type Sql = typeof sqlClient;

/**
 * Statuses in which the Lab can confirm that ordered items arrived. Includes orders the
 * Vendor never acknowledged, because Vendors often do not use the portal at all.
 */
export const LAB_RECEIPT_STATUSES: readonly string[] = [
  "SUBMITTED", "ACKNOWLEDGED", "CONFIRMED", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_RECEIVED",
];

export const PO_RECEIPT_ITEMS_CHANGED = "PO_RECEIPT_ITEMS_CHANGED";

export type LabReceiptItem = { id: number; item_id: string; item_name: string; qty: number };

type LabReceiptResult =
  | { ok: true; status: string; items: LabReceiptItem[] }
  | { ok: false; httpStatus: number; error: string };

function parseItemIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = value.map((id) => Number(id));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return null;
  return Array.from(new Set(ids));
}

/**
 * Lab confirms that the selected order lines arrived in full. No quantity is entered: each
 * selected line is marked received for its whole outstanding amount. Stock is NOT changed
 * here; the Lab still receives the goods into inventory on the Receive page.
 */
export async function confirmLabReceipt(sql: Sql, input: {
  po: { id: number; po_number: string; status: string };
  poItemIds: unknown;
}): Promise<LabReceiptResult> {
  const { po } = input;
  const ids = parseItemIds(input.poItemIds);
  if (!ids) return { ok: false, httpStatus: 400, error: "Select at least one order line that arrived" };
  if (!LAB_RECEIPT_STATUSES.includes(po.status)) {
    return { ok: false, httpStatus: 409, error: "This order cannot be marked as received in its current status" };
  }

  const lines = await sql`
    SELECT id, item_id, item_name, quantity, COALESCE(accepted_qty, 0) AS accepted_qty
    FROM purchase_order_items
    WHERE po_id = ${po.id}
  `;
  const byId = new Map(lines.map((line) => [Number(line.id), line]));
  const selected = ids.map((id) => byId.get(id));
  if (selected.some((line) => !line)) return { ok: false, httpStatus: 400, error: "A selected line does not belong to this order" };
  if (selected.some((line) => Number(line!.accepted_qty) >= Number(line!.quantity))) {
    return { ok: false, httpStatus: 409, error: "A selected line was already received" };
  }

  let result: Awaited<ReturnType<typeof runGuardedPurchaseOrderUpdate>>;
  try {
    result = await runGuardedPurchaseOrderUpdate(sql, po.id, po.status, [
      // Receiving the same goods through a Vendor shipment too would count them twice.
      sql`
        SELECT labstock_assert(NOT EXISTS (
          SELECT 1 FROM shipments WHERE po_number = ${po.po_number} AND status = 'In Transit'
        ), ${PO_HAS_IN_TRANSIT}) AS ok
      `,
      sql`
        SELECT labstock_assert((
          SELECT COUNT(*) FROM purchase_order_items
          WHERE po_id = ${po.id} AND id = ANY(${ids}::int[]) AND COALESCE(accepted_qty, 0) < quantity
        ) = ${ids.length}, ${PO_RECEIPT_ITEMS_CHANGED}) AS ok
      `,
      sql`
        UPDATE purchase_order_items
        SET received_qty = COALESCE(received_qty, 0) + (quantity - COALESCE(accepted_qty, 0)),
            accepted_qty = quantity
        WHERE po_id = ${po.id} AND id = ANY(${ids}::int[]) AND COALESCE(accepted_qty, 0) < quantity
        RETURNING id, item_id, item_name, quantity
      `,
      // Orders the Vendor never answered enter the fulfillment statuses the recompute handles.
      sql`
        UPDATE purchase_orders SET status = 'CONFIRMED', updated_at = NOW()
        WHERE id = ${po.id} AND status IN ('SUBMITTED', 'ACKNOWLEDGED')
      `,
      recomputePurchaseOrderStatusQuery(sql, po.po_number),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes(PO_HAS_IN_TRANSIT)) {
      return { ok: false, httpStatus: 409, error: "Receive or cancel the in-transit shipments before confirming receipt" };
    }
    if (error instanceof Error && error.message.includes(PO_RECEIPT_ITEMS_CHANGED)) {
      return { ok: false, httpStatus: 409, error: "A selected line was already received" };
    }
    throw error;
  }
  if (!result) return { ok: false, httpStatus: 409, error: "This order changed before receipt could be confirmed" };

  const recomputed = result[result.length - 1] as Array<{ status: string }>;
  const items = selected.map((line) => ({
    id: Number(line!.id),
    item_id: String(line!.item_id),
    item_name: String(line!.item_name ?? ""),
    qty: Number(line!.quantity) - Number(line!.accepted_qty),
  }));
  return { ok: true, status: recomputed[0]?.status ?? po.status, items };
}
