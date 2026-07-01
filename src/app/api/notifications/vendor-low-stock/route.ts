import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { notifyUsers } from "@/lib/notifications";
import { LowStockItem } from "@/lib/line-flex-templates";
import { ensureVendorNotificationSchema } from "@/lib/vendor-notification-utils";

type VendorLowStockRow = LowStockItem & {
  vendor: string;
};

async function isAuthorized(request: Request) {
  const cronSecret = process.env.LOW_STOCK_NOTIFICATION_CRON_SECRET;
  const requestSecret = request.headers.get("x-cron-secret");

  if (cronSecret && requestSecret === cronSecret) {
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

    const lowStockRows = await sql`
      WITH inventory_summary AS (
        SELECT item_id, SUM(quantity) as current_qty
        FROM inventory
        GROUP BY item_id
      )
      SELECT
        m.vendor,
        m.item_id as "itemId",
        m.name,
        m.unit,
        m.min_threshold as "minThreshold",
        COALESCE(i.current_qty, 0) as quantity
      FROM master_data m
      LEFT JOIN inventory_summary i ON m.item_id = i.item_id
      WHERE COALESCE(m.vendor, '') != ''
        AND COALESCE(i.current_qty, 0) <= m.min_threshold
      ORDER BY m.vendor ASC, m.name ASC
    `;

    if (lowStockRows.length === 0) {
      return NextResponse.json({ success: true, notifiedVendors: 0, notifiedItems: 0 });
    }

    const rowsByVendor = new Map<string, LowStockItem[]>();
    (lowStockRows as VendorLowStockRow[]).forEach((row) => {
      const vendor = row.vendor;
      if (!rowsByVendor.has(vendor)) {
        rowsByVendor.set(vendor, []);
      }
      rowsByVendor.get(vendor)?.push({
        itemId: row.itemId,
        name: row.name,
        quantity: Number(row.quantity),
        minThreshold: Number(row.minThreshold),
        unit: row.unit
      });
    });

    let notifiedVendors = 0;
    let notifiedItems = 0;

    for (const [vendor, items] of rowsByVendor.entries()) {
      const settings = await sql`
        SELECT
          n.username,
          n.email,
          n.line_user_id,
          n.notify_low_stock
        FROM notification_settings n
        JOIN users u ON u.username = n.username
        WHERE u.role = 'Vendor'
          AND u.vendor = ${vendor}
          AND n.notify_low_stock = true
          AND (n.line_user_id IS NOT NULL OR n.email IS NOT NULL)
      `;

      if (settings.length === 0) {
        continue;
      }

      await notifyUsers("LOW_STOCK", items, settings);
      notifiedVendors += 1;
      notifiedItems += items.length;
    }

    return NextResponse.json({
      success: true,
      notifiedVendors,
      notifiedItems
    });
  } catch (error: unknown) {
    console.error("Vendor low-stock notification error:", error);
    const message = error instanceof Error ? error.message : "Failed to send vendor low-stock alerts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
