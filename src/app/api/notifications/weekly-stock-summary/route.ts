import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, notifyUsers } from "@/lib/notifications";
import { WeeklyStockSummaryItem } from "@/lib/line-flex-templates";
import { ensureVendorNotificationSchema } from "@/lib/vendor-notification-utils";

type RequestItem = WeeklyStockSummaryItem;

async function isAuthorized(request: Request) {
  const cronSecrets = [
    process.env.WEEKLY_STOCK_NOTIFICATION_CRON_SECRET,
    process.env.CRON_SECRET,
  ].filter((secret): secret is string => Boolean(secret));
  const requestSecret = request.headers.get("x-cron-secret");
  const authorization = request.headers.get("authorization");

  if (cronSecrets.some((secret) => (
    requestSecret === secret || authorization === `Bearer ${secret}`
  ))) {
    return true;
  }

  const user = await getAuthenticatedUser(request);
  return user?.role === "Admin" || user?.role === "Manager";
}

export async function POST(request: Request) {
  try {
    const allowed = await isAuthorized(request);
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureVendorNotificationSchema();

    const body = await request.json().catch(() => ({}));
    const requestItems = Array.isArray(body.items) ? (body.items as RequestItem[]) : [];

    let items: WeeklyStockSummaryItem[] = [];

    if (requestItems.length > 0) {
      items = requestItems
        .filter((item) => item.vendor && item.name)
        .map((item) => ({
          itemId: item.itemId,
          name: item.name,
          quantity: Number(item.quantity) || 0,
          unit: item.unit,
          weeklyTarget: Number(item.weeklyTarget) || 0,
          vendor: item.vendor
        }));
    } else {
      const rows = await sql`
        WITH inventory_summary AS (
          SELECT item_id, SUM(quantity) as current_qty
          FROM inventory
          GROUP BY item_id
        )
        SELECT
          m.item_id as "itemId",
          m.name,
          COALESCE(i.current_qty, 0) as quantity,
          m.unit,
          m.weekly_target as "weeklyTarget",
          m.vendor
        FROM master_data m
        LEFT JOIN inventory_summary i ON m.item_id = i.item_id
        WHERE COALESCE(m.vendor, '') != ''
        ORDER BY m.vendor ASC, m.name ASC
      `;

      items = (rows as WeeklyStockSummaryItem[]).map((row) => ({
        itemId: row.itemId,
        name: row.name,
        quantity: Number(row.quantity),
        unit: row.unit,
        weeklyTarget: Number(row.weeklyTarget),
        vendor: row.vendor
      }));
    }

    if (items.length === 0) {
      return NextResponse.json({ success: true, notifiedVendors: 0, notifiedItems: 0 });
    }

    const itemsByVendor = new Map<string, WeeklyStockSummaryItem[]>();
    items.forEach((item) => {
      if (!itemsByVendor.has(item.vendor)) {
        itemsByVendor.set(item.vendor, []);
      }
      itemsByVendor.get(item.vendor)?.push(item);
    });

    const generalSettingsRows = await sql`
      SELECT
        n.username,
        n.email,
        n.line_user_id,
        n.notify_weekly_summary
      FROM notification_settings n
      JOIN users u ON u.username = n.username
      WHERE u.role <> 'Vendor'
        AND n.notify_weekly_summary = true
        AND (n.line_user_id IS NOT NULL OR n.email IS NOT NULL)
    `;
    const generalSettings = normalizeNotificationSettings(generalSettingsRows);

    if (generalSettings.length > 0) {
      await notifyUsers("WEEKLY_STOCK", items, generalSettings);
    }

    let notifiedVendors = 0;
    let notifiedItems = 0;

    for (const [vendor, vendorItems] of itemsByVendor.entries()) {
      const settingsRows = await sql`
        SELECT
          n.username,
          n.email,
          n.line_user_id,
          n.notify_weekly_summary
        FROM notification_settings n
        JOIN users u ON u.username = n.username
        WHERE u.role = 'Vendor'
          AND u.vendor = ${vendor}
          AND n.notify_weekly_summary = true
          AND (n.line_user_id IS NOT NULL OR n.email IS NOT NULL)
      `;

      const settings = normalizeNotificationSettings(settingsRows);

      if (settings.length === 0) {
        continue;
      }

      await notifyUsers("WEEKLY_STOCK", vendorItems, settings);
      notifiedVendors += 1;
      notifiedItems += vendorItems.length;
    }

    return NextResponse.json({
      success: true,
      notifiedUsers: generalSettings.length,
      notifiedVendors,
      notifiedItems
    });
  } catch (error: unknown) {
    console.error("Weekly stock summary notification error:", error);
    const message = error instanceof Error ? error.message : "Failed to send weekly stock summary";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
