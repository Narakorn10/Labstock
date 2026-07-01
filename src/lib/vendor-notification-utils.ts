import sql from "@/lib/db";

export async function ensureVendorNotificationSchema() {
  await sql`
    ALTER TABLE notification_settings
    ADD COLUMN IF NOT EXISTS notify_expiring_soon BOOLEAN DEFAULT true
  `;

  await sql`
    ALTER TABLE notification_settings
    ADD COLUMN IF NOT EXISTS notify_weekly_summary BOOLEAN DEFAULT true
  `;
}
