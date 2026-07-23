import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, notifyUsers } from "@/lib/notifications";
import { type ExpiringSoonItem, type WeeklyLowStockItem, type WeeklyStockAlertPayload } from "@/lib/line-flex-templates";
import { ensureVendorNotificationSchema } from "@/lib/vendor-notification-utils";

type ExpiringItem = ExpiringSoonItem & { jobType: string; vendor: string };

function getLineOrderUrl() {
  const explicitLiffUrl = process.env.NEXT_PUBLIC_LINE_ORDER_LIFF_URL?.trim();
  if (explicitLiffUrl) return explicitLiffUrl;

  const liffId = process.env.NEXT_PUBLIC_LINE_ORDER_LIFF_ID?.trim();
  if (liffId) return `https://liff.line.me/${liffId}`;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/liff/orders`;

  return undefined;
}

async function isAuthorized(request: Request) {
  const cronSecrets = [process.env.WEEKLY_STOCK_NOTIFICATION_CRON_SECRET, process.env.CRON_SECRET].filter((secret): secret is string => Boolean(secret));
  const requestSecret = request.headers.get("x-cron-secret");
  const authorization = request.headers.get("authorization");
  if (cronSecrets.some((secret) => requestSecret === secret || authorization === `Bearer ${secret}`)) return true;
  const user = await getAuthenticatedUser(request);
  return user?.role === "Admin" || user?.role === "Manager";
}

async function getWeeklyAlerts(): Promise<WeeklyStockAlertPayload> {
  const lowStockRows = await sql`
    WITH inventory_summary AS (
      SELECT item_id, SUM(quantity) AS current_qty FROM inventory GROUP BY item_id
    )
    SELECT m.item_id AS "itemId", m.name, m.unit, m.min_threshold AS "minThreshold",
      COALESCE(NULLIF(m.job_type, ''), 'ไม่ระบุงาน') AS "jobType", COALESCE(m.vendor, '') AS vendor,
      COALESCE(i.current_qty, 0) AS quantity
    FROM master_data m
    LEFT JOIN inventory_summary i ON i.item_id = m.item_id
    WHERE COALESCE(i.current_qty, 0) <= m.min_threshold
    ORDER BY "jobType", COALESCE(i.current_qty, 0), m.name
  `;
  const expiringRows = await sql`
    SELECT i.item_id AS "itemId", m.name, i.lot_no AS "lotNo", i.exp_date::date AS "expDate",
      i.quantity, m.unit, GREATEST(0, (i.exp_date::date - CURRENT_DATE))::int AS "daysUntilExpiry",
      COALESCE(NULLIF(m.job_type, ''), 'ไม่ระบุงาน') AS "jobType", COALESCE(m.vendor, '') AS vendor
    FROM inventory i
    JOIN master_data m ON m.item_id = i.item_id
    WHERE i.quantity > 0 AND i.exp_date IS NOT NULL
      AND i.exp_date::date >= CURRENT_DATE AND i.exp_date::date <= CURRENT_DATE + INTERVAL '30 days'
    ORDER BY i.exp_date ASC, "jobType", m.name
  `;
  return {
    lowStockItems: (lowStockRows as WeeklyLowStockItem[]).map((item) => ({ ...item, quantity: Number(item.quantity), minThreshold: Number(item.minThreshold) })),
    expiringSoonItems: (expiringRows as ExpiringItem[]).map((item) => ({ ...item, quantity: Number(item.quantity), daysUntilExpiry: Number(item.daysUntilExpiry) })),
  };
}

export async function POST(request: Request) {
  try {
    if (!await isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureVendorNotificationSchema();
    const alerts = await getWeeklyAlerts();
    const recipientRows = await sql`
      SELECT n.username, n.email, n.line_user_id, n.notify_weekly_summary, u.role, u.vendor
      FROM notification_settings n JOIN users u ON u.username = n.username
      WHERE n.notify_weekly_summary = true AND (n.line_user_id IS NOT NULL OR n.email IS NOT NULL)
    `;
    const generalRows = recipientRows.filter((row) => row.role !== "Vendor");
    const generalSettings = normalizeNotificationSettings(generalRows);
    if (generalSettings.length) await notifyUsers("WEEKLY_STOCK_ALERTS", { ...alerts, orderUrl: getLineOrderUrl() }, generalSettings);

    let notifiedVendors = 0;
    for (const row of recipientRows.filter((candidate) => candidate.role === "Vendor")) {
      const vendor = String(row.vendor ?? "");
      const vendorAlerts: WeeklyStockAlertPayload = {
        lowStockItems: alerts.lowStockItems.filter((item) => item.vendor === vendor),
        expiringSoonItems: alerts.expiringSoonItems.filter((item) => item.vendor === vendor),
      };
      await notifyUsers("WEEKLY_STOCK_ALERTS", vendorAlerts, normalizeNotificationSettings([row]));
      notifiedVendors += 1;
    }
    return NextResponse.json({ success: true, notifiedUsers: generalSettings.length, notifiedVendors, lowStockItems: alerts.lowStockItems.length, expiringSoonItems: alerts.expiringSoonItems.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send weekly stock alerts";
    console.error("Weekly stock summary notification error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
