import sql from "@/lib/db";

export async function ensureReorderRiskNotificationSchema() {
  await sql`
    ALTER TABLE notification_settings
    ADD COLUMN IF NOT EXISTS notify_reorder_risk BOOLEAN DEFAULT true
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS reorder_risk_notification_logs (
      id SERIAL PRIMARY KEY,
      item_id TEXT NOT NULL,
      status TEXT NOT NULL,
      notification_week_start DATE NOT NULL,
      notified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (item_id, status, notification_week_start)
    )
  `;
}

export function getMonday(date = new Date()) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() - (day === 0 ? 6 : day - 1));
  return result.toISOString().slice(0, 10);
}
