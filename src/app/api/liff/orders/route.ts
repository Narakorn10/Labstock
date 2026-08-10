import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { normalizeNotificationSettings, normalizePurchaseOrder, notifyUsers } from "@/lib/notifications";
import { validatePurchaseOrderItems } from "@/lib/purchase-order-workflow";
import { getLinePurchasingUserFromRequest, purchaseOrderHasLiffRequestColumn } from "@/lib/line-liff-ordering";
import { createPurchaseOrderWithAudit, PurchaseOrderCreationError } from "@/lib/purchase-order-creation";

async function getManagerSettings() {
  const rows = await sql`
    SELECT n.*
    FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role = 'Manager'
  `;
  return normalizeNotificationSettings(rows);
}

export async function POST(request: Request) {
  try {
    const auth = await getLinePurchasingUserFromRequest(request);
    if (!auth.ok) return auth.response;

    const vendor = String(auth.body.vendor ?? "").trim();
    const items = validatePurchaseOrderItems(auth.body.items);
    const note = String(auth.body.note ?? "").trim() || null;
    const expectedDate = auth.body.expected_date ? String(auth.body.expected_date) : null;
    const liffRequestId = String(auth.body.liffRequestId ?? "").trim();

    if (!vendor || !items) {
      return NextResponse.json({ error: "Vendor and valid order items are required." }, { status: 400 });
    }

    const hasLiffRequestColumn = await purchaseOrderHasLiffRequestColumn();
    if (hasLiffRequestColumn && liffRequestId) {
      const existing = await sql`
        SELECT * FROM purchase_orders
        WHERE liff_request_id = ${liffRequestId}
        LIMIT 1
      `;
      if (existing.length) {
        const existingItems = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${existing[0].id} ORDER BY id`;
        return NextResponse.json({ ...existing[0], items: existingItems, deduplicated: true });
      }
    }

    const created = await createPurchaseOrderWithAudit({
      user: auth.user,
      vendor,
      items,
      note,
      expectedDate,
      origin: "LAB",
      liffRequestId,
      storeLiffRequestId: hasLiffRequestColumn,
    });
    const fullPO = normalizePurchaseOrder(created.purchaseOrder, created.items.map((item) => ({
      item_name: String(item.item_name),
      quantity: Number(item.quantity),
      unit: String(item.unit),
    })));
    await notifyUsers("PO_REVIEW_REQUIRED", fullPO, await getManagerSettings());

    return NextResponse.json(fullPO, { status: 201 });
  } catch (error) {
    console.error("LIFF order create error:", error);
    if (error instanceof PurchaseOrderCreationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to submit purchase order from LINE." }, { status: 500 });
  }
}
