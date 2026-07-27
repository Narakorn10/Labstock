import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user || user.role !== "Vendor") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.vendor) return NextResponse.json({ error: "Vendor profile is not configured" }, { status: 403 });

  try {
    const orders = await sql`
      SELECT p.id, p.po_number, p.expected_date, p.status, p.vendor,
        json_agg(json_build_object(
          'itemId', poi.item_id, 'itemName', poi.item_name, 'unit', poi.unit,
          'orderedQty', poi.quantity,
          'remainingQty', GREATEST(poi.quantity - COALESCE(shipped.shipped_qty, 0), 0)
        ) ORDER BY poi.id) AS items
      FROM purchase_orders p
      JOIN purchase_order_items poi ON poi.po_id = p.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(s.quantity), 0) AS shipped_qty
        FROM shipments s
        WHERE s.po_number = p.po_number AND s.item_id = poi.item_id AND s.status <> 'Cancelled'
      ) shipped ON true
      WHERE p.vendor = ${user.vendor}
        AND p.status IN ('CONFIRMED', 'PARTIALLY_SHIPPED')
      GROUP BY p.id
      ORDER BY p.confirmed_at DESC NULLS LAST, p.created_at DESC
    `;
    return NextResponse.json(orders);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load confirmed orders" }, { status: 500 });
  }
}
