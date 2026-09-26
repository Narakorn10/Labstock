import type sqlClient from "./db";

type Sql = typeof sqlClient;

/** Statuses whose value is derived from shipments and receipts. Other statuses are never overwritten. */
export const FULFILLMENT_STATUSES = ["CONFIRMED", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_RECEIVED"] as const;

/**
 * Recomputes a purchase order's fulfillment status from its items and shipments.
 *
 * Must run as its own statement AFTER the shipment/receipt writes, inside the same
 * `sql.transaction([...])`. Inside a single statement, data-modifying CTEs all read
 * the pre-statement snapshot, so a CTE-embedded recompute lags one step behind.
 */
export function recomputePurchaseOrderStatusQuery(sql: Sql, poNumber: string | null) {
  return sql`
    WITH next AS (
      SELECT p.id, CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          WHERE poi.po_id = p.id AND COALESCE(poi.accepted_qty, 0) < poi.quantity
        ) THEN 'RECEIVED'
        WHEN EXISTS (
          SELECT 1 FROM purchase_order_items poi
          WHERE poi.po_id = p.id AND COALESCE(poi.accepted_qty, 0) > 0
        ) THEN 'PARTIALLY_RECEIVED'
        WHEN NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          LEFT JOIN shipments s ON s.po_number = p.po_number AND s.item_id = poi.item_id AND s.status = 'In Transit'
          WHERE poi.po_id = p.id
          GROUP BY poi.id, poi.quantity
          HAVING COALESCE(SUM(s.quantity), 0) < poi.quantity
        ) THEN 'SHIPPED'
        WHEN EXISTS (
          SELECT 1 FROM shipments s WHERE s.po_number = p.po_number AND s.status = 'In Transit'
        ) THEN 'PARTIALLY_SHIPPED'
        ELSE 'CONFIRMED'
      END AS status
      FROM purchase_orders p
      WHERE p.po_number = ${poNumber}
        AND p.status IN ('CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
    )
    UPDATE purchase_orders p
    SET status = next.status,
        received_at = CASE WHEN next.status = 'RECEIVED' THEN COALESCE(p.received_at, NOW()) ELSE p.received_at END,
        updated_at = NOW()
    FROM next
    WHERE p.id = next.id
    RETURNING p.id, p.status
  `;
}
