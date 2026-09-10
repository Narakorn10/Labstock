import sql from "@/lib/db";
import { after } from "next/server";
import type { AuthenticatedUser } from "@/lib/auth-utils";

export type PurchaseOrderCommunicationEvent =
  | "PO_CREATED"
  | "PO_REVIEW_REQUIRED"
  | "PO_CONFIRMED"
  | "PO_STATUS_UPDATED"
  | "PO_SHIPPED"
  | "PO_RECEIVED"
  | "PO_CANCELLED"
  | "SHIPMENT_REPLACEMENT_REQUIRED";

type Row = Record<string, unknown>;

function asString(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function notificationEnabled(event: PurchaseOrderCommunicationEvent, row: Row) {
  if (event === "PO_CREATED" || event === "PO_REVIEW_REQUIRED") return row.notify_po_created !== false;
  if (event === "PO_CONFIRMED") return row.notify_po_confirmed !== false;
  if (event === "PO_SHIPPED") return row.notify_po_shipped !== false;
  if (event === "PO_RECEIVED") return row.notify_po_received !== false;
  return row.notify_po_status_updates !== false;
}

function eventVisibility(actorRole?: string, recipientRole?: string) {
  if (actorRole === "Vendor" || recipientRole === "Vendor") return "BOTH";
  return "BOTH";
}

export async function recordPurchaseOrderCommunication(input: {
  poId: number;
  eventType: PurchaseOrderCommunicationEvent;
  actor?: Pick<AuthenticatedUser, "username" | "role">;
  source?: "WEB" | "LIFF" | "LINE" | "SYSTEM" | "MIGRATION";
  note?: string | null;
  shipmentId?: number | null;
  metadata?: Record<string, unknown>;
}) {
  const poRows = await sql`
    SELECT p.*, COALESCE(jsonb_agg(jsonb_build_object(
      'item_name', poi.item_name, 'quantity', poi.quantity, 'unit', poi.unit
    ) ORDER BY poi.id) FILTER (WHERE poi.id IS NOT NULL), '[]'::jsonb) AS items
    FROM purchase_orders p
    LEFT JOIN purchase_order_items poi ON poi.po_id = p.id
    WHERE p.id = ${input.poId}
    GROUP BY p.id
  `;
  if (!poRows.length) return { eventId: null, queued: 0 };
  const po = poRows[0] as Row;
  const poNumber = asString(po.po_number);
  const fromStatus = input.metadata?.fromStatus ? asString(input.metadata.fromStatus) : null;
  const toStatus = asString(po.status);
  const visibility = eventVisibility(input.actor?.role);
  const eventRows = await sql`
    INSERT INTO purchase_order_events
      (po_id, po_number, shipment_id, event_type, from_status, to_status, actor_username, actor_role, source, visibility, note, metadata)
    VALUES
      (${input.poId}, ${poNumber}, ${input.shipmentId ?? null}, ${input.eventType}, ${fromStatus}, ${toStatus},
       ${input.actor?.username ?? null}, ${input.actor?.role ?? null}, ${input.source ?? "WEB"}, ${visibility},
       ${input.note?.trim() || null}, ${JSON.stringify(input.metadata ?? {})}::jsonb)
    RETURNING id
  `;
  const eventId = Number(eventRows[0]?.id);

  const recipients = await sql`
    SELECT n.username, n.email, n.line_user_id, u.role,
      COALESCE(n.notify_po_created, TRUE) AS notify_po_created,
      COALESCE(n.notify_po_confirmed, TRUE) AS notify_po_confirmed,
      COALESCE(n.notify_po_shipped, TRUE) AS notify_po_shipped,
      COALESCE(n.notify_po_received, TRUE) AS notify_po_received,
      COALESCE(n.notify_po_status_updates, TRUE) AS notify_po_status_updates
    FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE COALESCE(u.account_status, 'active') = 'active'
      AND (
        (u.role IN ('Admin', 'Manager'))
        OR (u.role = 'Vendor' AND u.vendor = ${po.vendor})
      )
  `;

  let queued = 0;
  for (const recipient of recipients as Row[]) {
    const role = asString(recipient.role);
    if (!notificationEnabled(input.eventType, recipient)) continue;
    const payload = JSON.stringify({
      po: {
        id: Number(po.id), po_number: poNumber, vendor: asString(po.vendor), status: toStatus,
        expected_date: po.expected_date ? asString(po.expected_date) : null,
        items: Array.isArray(po.items) ? po.items : [],
      },
      eventType: input.eventType,
      note: input.note ?? null,
    });
    const channels: Array<{ channel: "LINE" | "EMAIL"; address: string | null }> = [
      { channel: "LINE", address: recipient.line_user_id ? asString(recipient.line_user_id) : null },
      { channel: "EMAIL", address: recipient.email ? asString(recipient.email) : null },
    ];
    for (const channel of channels) {
      if (!channel.address) continue;
      const key = `${eventId}:${asString(recipient.username)}:${channel.channel}`;
      const result = await sql`
        INSERT INTO notification_outbox
          (event_id, event_type, po_id, shipment_id, recipient_username, recipient_role, channel, recipient_address, payload, idempotency_key)
        VALUES
          (${eventId}, ${input.eventType}, ${input.poId}, ${input.shipmentId ?? null}, ${asString(recipient.username)}, ${role},
           ${channel.channel}, ${channel.address}, ${payload}::jsonb, ${key})
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `;
      if (result.length) queued += 1;
    }
  }
  // Vercel Hobby only permits daily Cron; trigger a best-effort immediate drain after
  // the response while the durable daily reconciliation remains the safety net.
  try {
    after(async () => {
      const { drainNotificationOutbox } = await import("@/lib/notification-outbox");
      await drainNotificationOutbox(20);
    });
  } catch {
    // `after` is unavailable in unit tests or non-request callers; the cron worker remains authoritative.
  }
  return { eventId, queued };
}

export async function listPurchaseOrderEvents(poId: number, user: AuthenticatedUser, before?: number, limit = 50) {
  const poRows = await sql`SELECT vendor FROM purchase_orders WHERE id = ${poId} LIMIT 1`;
  if (!poRows.length) return null;
  if (user.role === "Vendor" && poRows[0].vendor !== user.vendor) return "FORBIDDEN" as const;
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const rows = user.role === "Vendor"
    ? await sql`
        SELECT id, po_number, shipment_id, event_type, from_status, to_status, actor_role, source, note, metadata, created_at
        FROM purchase_order_events
        WHERE po_id = ${poId} AND visibility IN ('VENDOR', 'BOTH') AND (${before ?? null}::bigint IS NULL OR id < ${before ?? null})
        ORDER BY id DESC LIMIT ${safeLimit}
      `
    : await sql`
        SELECT id, po_number, shipment_id, event_type, from_status, to_status, actor_role, source, note, metadata, created_at
        FROM purchase_order_events
        WHERE po_id = ${poId} AND visibility IN ('LAB', 'BOTH') AND (${before ?? null}::bigint IS NULL OR id < ${before ?? null})
        ORDER BY id DESC LIMIT ${safeLimit}
      `;
  return { items: rows, nextCursor: rows.length === safeLimit ? Number(rows[rows.length - 1].id) : null };
}
