import sql from "./db";
import { recordPurchaseOrderCommunication } from "./po-communication";

export type OverdueEvent = "VENDOR_RESPONSE_OVERDUE" | "DELIVERY_OVERDUE";

type OverdueOrder = { id: number; po_number: string; event_type: OverdueEvent; due: string | null };

/**
 * Finds orders where the Vendor is late, skipping any already reminded in the last 20 hours
 * so a daily cron reminds the Lab at most once a day. Statuses are never changed.
 *  - VENDOR_RESPONSE_OVERDUE: SUBMITTED/ACKNOWLEDGED past vendor_response_due_at
 *  - DELIVERY_OVERDUE: expected_date passed and the order is not fully delivered or in transit
 */
export async function findOverduePurchaseOrders(): Promise<OverdueOrder[]> {
  const rows = await sql`
    SELECT p.id, p.po_number, overdue.event_type, overdue.due
    FROM purchase_orders p
    CROSS JOIN LATERAL (
      SELECT 'VENDOR_RESPONSE_OVERDUE' AS event_type, p.vendor_response_due_at::text AS due
      WHERE p.status IN ('SUBMITTED', 'ACKNOWLEDGED') AND p.vendor_response_due_at < NOW()
      UNION ALL
      SELECT 'DELIVERY_OVERDUE', p.expected_date::text
      WHERE p.status IN ('CONFIRMED', 'PARTIALLY_SHIPPED', 'PARTIALLY_RECEIVED') AND p.expected_date < CURRENT_DATE
    ) overdue
    WHERE NOT EXISTS (
      SELECT 1 FROM purchase_order_events e
      WHERE e.po_id = p.id AND e.event_type = overdue.event_type AND e.created_at > NOW() - INTERVAL '20 hours'
    )
    ORDER BY p.id
  `;
  return rows as OverdueOrder[];
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
