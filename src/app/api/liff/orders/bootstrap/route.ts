import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getLinePurchasingUserFromRequest } from "@/lib/line-liff-ordering";

export async function POST(request: Request) {
  try {
    const auth = await getLinePurchasingUserFromRequest(request);
    if (!auth.ok) return auth.response;

    const vendors = await sql`
      SELECT vendor, COUNT(*)::int AS item_count
      FROM master_data
      WHERE vendor IS NOT NULL AND TRIM(vendor) <> ''
      GROUP BY vendor
      ORDER BY vendor
    `;

    const orders = await sql`
      SELECT p.*
      FROM purchase_orders p
      WHERE p.status IN ('SUBMITTED', 'PENDING_LAB_REVIEW', 'REVISION_REQUESTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED')
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
      LIMIT 30
    `;

    const ordersWithItems = await Promise.all(orders.map(async (po) => ({
      ...po,
      items: await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`,
    })));

    return NextResponse.json({ user: auth.user, vendors, orders: ordersWithItems });
  } catch (error) {
    console.error("LIFF orders bootstrap error:", error);
    return NextResponse.json({ error: "Unable to load LINE ordering workspace." }, { status: 500 });
  }
}
