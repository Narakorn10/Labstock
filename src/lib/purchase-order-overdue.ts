import sql from "./db";
import { SHIPMENTS_ENABLED } from "./feature-flags";
import { recordPurchaseOrderCommunication } from "./po-communication";

export type OverdueEvent = "VENDOR_RESPONSE_OVERDUE" | "DELIVERY_OVERDUE";

type OverdueOrder = { id: number; po_number: string; event_type: OverdueEvent; due: string | null };

export const VENDOR_RESPONSE_DAYS = 5;
export const MAX_REMINDERS_PER_ORDER = 3;

/**
 * Finds orders where the Vendor is late. Each order is reminded at most once a day
 * and at most MAX_REMINDERS_PER_ORDER times per event, so stale orders go quiet.
 * Statuses are never changed.
 *  - VENDOR_RESPONSE_OVERDUE: SUBMITTED/ACKNOWLEDGED past the response deadline
 *    (orders sent straight to the Vendor have no stored deadline, so created_at + 5 days)
 *  - DELIVERY_OVERDUE: only while shipments are enabled
 */
export async function findOverduePurchaseOrders(): Promise<OverdueOrder[]> {
  const rows = await sql`
    SELECT p.id, p.po_number, overdue.event_type, overdue.due
    FROM purchase_orders p
    CROSS JOIN LATERAL (
      SELECT 'VENDOR_RESPONSE_OVERDUE' AS event_type,
        COALESCE(p.vendor_response_due_at, p.created_at + ${VENDOR_RESPONSE_DAYS} * INTERVAL '1 day')::text AS due
      WHERE p.status IN ('SUBMITTED', 'ACKNOWLEDGED')
        AND COALESCE(p.vendor_response_due_at, p.created_at + ${VENDOR_RESPONSE_DAYS} * INTERVAL '1 day') < NOW()
      UNION ALL
      SELECT 'DELIVERY_OVERDUE', p.expected_date::text
      WHERE p.status IN ('CONFIRMED', 'PARTIALLY_SHIPPED', 'PARTIALLY_RECEIVED') AND p.expected_date < CURRENT_DATE
    ) overdue
    WHERE NOT EXISTS (
      SELECT 1 FROM purchase_order_events e
      WHERE e.po_id = p.id AND e.event_type = overdue.event_type AND e.created_at > NOW() - INTERVAL '20 hours'
    )
    AND (
      SELECT COUNT(*) FROM purchase_order_events e
      WHERE e.po_id = p.id AND e.event_type = overdue.event_type
    ) < ${MAX_REMINDERS_PER_ORDER}
    ORDER BY p.id
  `;
  return (rows as OverdueOrder[]).filter((row) => SHIPMENTS_ENABLED || row.event_type !== "DELIVERY_OVERDUE");
}

/** Records one reminder event per overdue order; the event outbox notifies Admin/Manager. */
export async function remindOverduePurchaseOrders() {
  const overdue = await findOverduePurchaseOrders();
  for (const order of overdue) {
    await recordPurchaseOrderCommunication({
      poId: Number(order.id),
      eventType: order.event_type,
      source: "SYSTEM",
      metadata: { due: order.due },
    });
  }
  return overdue;
}
