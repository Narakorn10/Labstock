import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getReagentUsageInsights, ReagentUsageInsight } from "@/lib/reagent-usage-insights";
import { ensureReorderRiskNotificationSchema, getMonday } from "@/lib/reagent-usage-notifications";
import { normalizeNotificationSettings, notifyUsers } from "@/lib/notifications";

async function isAuthorized(request: Request) {
  const cronSecret = process.env.REORDER_RISK_NOTIFICATION_CRON_SECRET || process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const requestSecret = request.headers.get("x-cron-secret") || authorization?.replace(/^Bearer\s+/i, "");
  if (cronSecret && requestSecret === cronSecret) return true;

  const user = await getAuthenticatedUser(request);
  return user?.role === "Admin" || user?.role === "Manager";
}

export async function POST(request: Request) {
  try {
    if (!await isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureReorderRiskNotificationSchema();
    const { insights } = await getReagentUsageInsights();
    const weekStart = getMonday();
    const riskItems = insights.filter((item) => item.status !== "normal");

    const itemsToNotify: ReagentUsageInsight[] = [];
    for (const item of riskItems) {
      const existing = await sql`
        SELECT id FROM reorder_risk_notification_logs
        WHERE item_id = ${item.itemId}
          AND status = ${item.status}
          AND notification_week_start = ${weekStart}::date
        LIMIT 1
      `;
      if (existing.length === 0) itemsToNotify.push(item);
    }

    if (itemsToNotify.length === 0) {
      return NextResponse.json({ success: true, notifiedItems: 0, skipped: "No new reorder risks this week" });
    }

    const settingsRows = await sql`
      SELECT n.username, n.email, n.line_user_id, n.notify_reorder_risk
      FROM notification_settings n
      JOIN users u ON u.username = n.username
      WHERE u.role IN ('Admin', 'Manager')
        AND n.notify_reorder_risk = true
        AND (n.line_user_id IS NOT NULL OR n.email IS NOT NULL)
    `;
    const settings = normalizeNotificationSettings(settingsRows);

    if (settings.length === 0) {
      return NextResponse.json({ success: true, notifiedItems: 0, skipped: "No recipients enabled reorder alerts" });
    }

    await notifyUsers("REORDER_RISK", itemsToNotify, settings);
    for (const item of itemsToNotify) {
      await sql`
        INSERT INTO reorder_risk_notification_logs (item_id, status, notification_week_start)
        VALUES (${item.itemId}, ${item.status}, ${weekStart}::date)
        ON CONFLICT (item_id, status, notification_week_start) DO NOTHING
      `;
    }

    return NextResponse.json({ success: true, notifiedItems: itemsToNotify.length, recipients: settings.length });
  } catch (error: unknown) {
    console.error("Reorder risk notification error:", error);
    const message = error instanceof Error ? error.message : "Failed to send reorder risk notification";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
