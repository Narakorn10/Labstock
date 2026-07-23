import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { normalizeNotificationSettings, normalizePurchaseOrder, notifyUsers } from "@/lib/notifications";
import { getLinePurchasingUserFromRequest } from "@/lib/line-liff-ordering";

async function getVendorSettings(vendor: string) {
  const rows = await sql`
    SELECT n.*
    FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role = 'Vendor' AND u.vendor = ${vendor}
  `;
  return normalizeNotificationSettings(rows);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getLinePurchasingUserFromRequest(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const status = String(auth.body.status ?? "");
    if (status !== "CONFIRMED" && status !== "REJECTED") {
      return NextResponse.json({ error: "Only CONFIRMED or REJECTED is allowed from LINE review." }, { status: 400 });
    }

    const poRows = Number.isInteger(Number(id))
      ? await sql`SELECT * FROM purchase_orders WHERE id = ${id} LIMIT 1`
      : await sql`SELECT * FROM purchase_orders WHERE po_number = ${id} LIMIT 1`;
    if (!poRows.length) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });

    const po = poRows[0];
    const awaitingLabReview = po.status === "PENDING_LAB_REVIEW" || po.status === "REVISION_REQUESTED";
    if (!awaitingLabReview) {
      return NextResponse.json({ error: "This order is not awaiting Lab review." }, { status: 409 });
    }

    await sql`
      UPDATE purchase_orders
      SET status = ${status},
          reviewed_at = NOW(),
          reviewed_by = ${auth.user.username},
          confirmed_at = ${status === "CONFIRMED" ? new Date().toISOString() : po.confirmed_at},
          updated_at = NOW()
      WHERE id = ${po.id}
    `;

    const updatedRows = await sql`SELECT * FROM purchase_orders WHERE id = ${po.id}`;
    const items = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`;
    const fullPO = normalizePurchaseOrder(updatedRows[0], items.map((item) => ({
      item_name: String(item.item_name),
      quantity: Number(item.quantity),
      unit: String(item.unit),
    })));
    await notifyUsers(status === "CONFIRMED" ? "PO_CONFIRMED" : "PO_STATUS_UPDATED", fullPO, await getVendorSettings(String(po.vendor)));

    return NextResponse.json({ ...updatedRows[0], items });
  } catch (error) {
    console.error("LIFF order review error:", error);
    return NextResponse.json({ error: "Unable to review purchase order from LINE." }, { status: 500 });
  }
}
