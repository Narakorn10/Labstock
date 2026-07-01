import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { notifyUsers } from "@/lib/notifications";
import { ExpiringSoonItem } from "@/lib/line-flex-templates";

const ALERT_WINDOW_DAYS = 30;
const NOTIFICATION_TYPE = "EXPIRING_SOON_30D";

async function ensureExpiryNotificationSchema() {
  await sql`
    ALTER TABLE notification_settings
    ADD COLUMN IF NOT EXISTS notify_expiring_soon BOOLEAN DEFAULT true
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS expiry_notification_logs (
      id SERIAL PRIMARY KEY,
      item_id TEXT NOT NULL,
      lot_no TEXT NOT NULL,
      exp_date DATE NOT NULL,
      notification_type TEXT NOT NULL DEFAULT 'EXPIRING_SOON_30D',
      notified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by_line_user_id TEXT,
      UNIQUE (item_id, lot_no, exp_date, notification_type)
    )
  `;

  await sql`
    ALTER TABLE expiry_notification_logs
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE expiry_notification_logs
    ADD COLUMN IF NOT EXISTS acknowledged_by_line_user_id TEXT
  `;
}

async function canRunExpiryNotification(request: Request) {
  const cronSecret = process.env.EXPIRY_NOTIFICATION_CRON_SECRET;
  const requestSecret = request.headers.get("x-cron-secret");

  if (cronSecret && requestSecret === cronSecret) {
    return true;
  }

  const user = await getAuthenticatedUser(request);
  return user?.role === "Admin";
}

export async function POST(request: Request) {
  try {
    const isAuthorized = await canRunExpiryNotification(request);
    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureExpiryNotificationSchema();

    const settings = await sql`
      SELECT username, email, line_user_id, notify_expiring_soon
      FROM notification_settings
      WHERE notify_expiring_soon = true
        AND (line_user_id IS NOT NULL OR email IS NOT NULL)
    `;

    if (settings.length === 0) {
      return NextResponse.json({
        success: true,
        notified: 0,
        skipped: "No recipients enabled for expiring-soon alerts"
      });
    }

    const items = await sql`
      SELECT
        i.item_id as "itemId",
        m.name,
        i.lot_no as "lotNo",
        i.exp_date::date as "expDate",
        i.quantity,
        m.unit,
        GREATEST(0, (i.exp_date::date - CURRENT_DATE))::int as "daysUntilExpiry"
      FROM inventory i
      JOIN master_data m ON m.item_id = i.item_id
      WHERE i.quantity > 0
        AND i.exp_date IS NOT NULL
        AND i.exp_date::date >= CURRENT_DATE
        AND i.exp_date::date <= CURRENT_DATE + ${ALERT_WINDOW_DAYS} * INTERVAL '1 day'
        AND NOT EXISTS (
          SELECT 1
          FROM expiry_notification_logs log
          WHERE log.item_id = i.item_id
            AND log.lot_no = i.lot_no
            AND log.exp_date = i.exp_date::date
            AND log.notification_type = ${NOTIFICATION_TYPE}
        )
      ORDER BY i.exp_date ASC, m.name ASC
    `;

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        notified: 0,
        skipped: "No new lots expiring within 30 days"
      });
    }

    await notifyUsers("EXPIRING_SOON", items as ExpiringSoonItem[], settings);

    for (const item of items as ExpiringSoonItem[]) {
      await sql`
        INSERT INTO expiry_notification_logs (item_id, lot_no, exp_date, notification_type)
        VALUES (${item.itemId}, ${item.lotNo}, ${item.expDate}, ${NOTIFICATION_TYPE})
        ON CONFLICT (item_id, lot_no, exp_date, notification_type) DO NOTHING
      `;
    }

    return NextResponse.json({
      success: true,
      notified: items.length,
      recipients: settings.length
    });
  } catch (error: unknown) {
    console.error("Expiring soon notification error:", error);
    const message = error instanceof Error ? error.message : "Failed to send expiring-soon alerts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
