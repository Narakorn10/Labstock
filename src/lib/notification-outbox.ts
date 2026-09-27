import crypto from "node:crypto";
import { messagingApi } from "@line/bot-sdk";
import sql from "@/lib/db";
import { sendEmailStrict } from "@/lib/notifications";
import { generatePOStatusTemplate } from "@/lib/line-flex-templates";
import { sendLinePushStrict } from "@/lib/line-bot";

type OutboxRow = {
  id: number;
  event_type: string;
  channel: "LINE" | "EMAIL";
  recipient_address: string;
  payload: Record<string, unknown>;
  attempts: number;
};

function poFromPayload(payload: Record<string, unknown>) {
  const value = payload.po;
  if (!value || typeof value !== "object") return null;
  return value as { po_number: string; vendor: string; status: string; expected_date?: string | null; items?: Array<{ item_name: string; quantity: number; unit: string }> };
}

function emailFor(row: OutboxRow) {
  const po = poFromPayload(row.payload);
  const poNumber = po?.po_number ?? "LabStock";
  const event = row.event_type.replaceAll("_", " ");
  return {
    subject: `${event}: ${poNumber}`,
    html: `<h3>LabStock notification</h3><p>Event: ${event}</p><p>PO: ${poNumber}</p>${po ? `<p>Status: ${po.status}</p><p>Vendor: ${po.vendor}</p>` : ""}`,
  };
}

const REMINDER_HEADINGS: Record<string, string> = {
  VENDOR_RESPONSE_OVERDUE: "⏰ Vendor ยังไม่ยืนยัน order",
  DELIVERY_OVERDUE: "⏰ เลยกำหนดส่งของ",
};

async function deliver(row: OutboxRow) {
  if (row.channel === "LINE") {
    const po = poFromPayload(row.payload);
    if (!po) throw new Error("Outbox payload has no purchase order");
    await sendLinePushStrict(row.recipient_address, [generatePOStatusTemplate(po, REMINDER_HEADINGS[row.event_type]) as messagingApi.Message]);
    return;
  }
  const email = emailFor(row);
  await sendEmailStrict(row.recipient_address, email.subject, email.html);
}

export async function drainNotificationOutbox(limit = 50) {
  const workerId = `${process.env.VERCEL_REGION ?? "local"}:${crypto.randomUUID()}`;
  const claimRows = await sql`
    WITH claimed AS (
      SELECT id
      FROM notification_outbox
      WHERE (status = 'PENDING' AND next_attempt_at <= NOW())
         OR (status = 'PROCESSING' AND locked_at < NOW() - INTERVAL '10 minutes')
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT ${Math.min(Math.max(limit, 1), 100)}
    )
    UPDATE notification_outbox o
    SET status = 'PROCESSING', locked_at = NOW(), locked_by = ${workerId}, attempts = o.attempts + 1, updated_at = NOW()
    FROM claimed
    WHERE o.id = claimed.id
    RETURNING o.id, o.event_type, o.channel, o.recipient_address, o.payload, o.attempts
  ` as OutboxRow[];

  let delivered = 0;
  let failed = 0;
  for (const row of claimRows) {
    try {
      await deliver(row);
      await sql`
        UPDATE notification_outbox
        SET status = 'DELIVERED', delivered_at = NOW(), locked_at = NULL, locked_by = NULL, last_error = NULL, updated_at = NOW()
        WHERE id = ${row.id} AND status = 'PROCESSING' AND locked_by = ${workerId}
      `;
      delivered += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const dead = row.attempts >= 8;
      const delayMinutes = Math.min(60 * 24, 2 ** Math.min(row.attempts, 10));
      await sql`
        UPDATE notification_outbox
        SET status = ${dead ? "DEAD" : "PENDING"},
            next_attempt_at = NOW() + (${dead ? 0 : delayMinutes} * INTERVAL '1 minute'),
            locked_at = NULL, locked_by = NULL, last_error = ${message.slice(0, 2000)}, updated_at = NOW()
        WHERE id = ${row.id} AND status = 'PROCESSING' AND locked_by = ${workerId}
      `;
      failed += 1;
    }
  }
  return { claimed: claimRows.length, delivered, failed };
}
