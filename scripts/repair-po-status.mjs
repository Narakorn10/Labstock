// Repairs purchase-order fulfillment statuses left one step behind by the old
// shipment/receipt CTEs (fixed in "Fix: recompute PO status after shipment and receipt writes").
//
//   node scripts/repair-po-status.mjs            -> dry run: prints what would change, writes nothing
//   node scripts/repair-po-status.mjs --apply    -> writes the changes in one transaction
//
// PRODUCTION-AFFECTING when --apply is used. Review the dry run first.
// The CASE below must stay identical to src/lib/purchase-order-status.ts.
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const apply = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);

const desired = sql`
  SELECT p.id, p.po_number, p.status AS current_status, p.received_at IS NOT NULL AS has_received_at,
    CASE
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
    END AS next_status,
    (SELECT MAX(s.received_at) FROM shipments s WHERE s.po_number = p.po_number AND s.status = 'Received') AS last_received_at
  FROM purchase_orders p
  WHERE p.status IN ('CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
    AND EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.po_id = p.id)
  ORDER BY p.id
`;

const rows = await desired;
const changes = rows.filter((row) =>
  row.current_status !== row.next_status || (row.next_status === "RECEIVED" && !row.has_received_at));

console.log(`Checked ${rows.length} open fulfillment orders; ${changes.length} need repair.`);
for (const row of changes) {
  console.log(`  ${row.po_number}: ${row.current_status} -> ${row.next_status}${row.next_status === "RECEIVED" && !row.has_received_at ? " (+received_at)" : ""}`);
}

if (!apply) {
  console.log(changes.length ? "Dry run only. Re-run with --apply to write these changes." : "Nothing to do.");
  process.exit(0);
}

if (!changes.length) process.exit(0);

// Each update re-checks the status it expects, so rows changed since the dry-run read are skipped.
await sql.transaction(changes.flatMap((row) => [
  sql`
    UPDATE purchase_orders
    SET status = ${row.next_status},
        received_at = CASE WHEN ${row.next_status} = 'RECEIVED' THEN COALESCE(received_at, ${row.last_received_at}, NOW()) ELSE received_at END,
        updated_at = NOW()
    WHERE id = ${row.id} AND status = ${row.current_status}
  `,
  sql`
    INSERT INTO purchase_order_events (po_id, po_number, event_type, from_status, to_status, actor_username, actor_role, source, visibility, note)
    SELECT ${row.id}, ${row.po_number}, 'PO_STATUS_UPDATED', ${row.current_status}, ${row.next_status}, 'system', 'System', 'MIGRATION', 'LAB',
      'Status repaired after fulfillment status bug fix'
    WHERE ${row.current_status} <> ${row.next_status}
      AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = ${row.id} AND status = ${row.next_status})
  `,
]));
console.log(`Applied ${changes.length} repairs.`);
