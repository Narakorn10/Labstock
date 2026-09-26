import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { normalizePurchaseOrder } from "@/lib/notifications";
import { recordPurchaseOrderCommunication } from "@/lib/po-communication";
import { describeInvalidPurchaseOrderItems, validatePurchaseOrderItems } from "@/lib/purchase-order-workflow";
import { getLinePurchasingUserFromRequest, purchaseOrderHasLiffRequestColumn } from "@/lib/line-liff-ordering";
import { createPurchaseOrderWithAudit, PurchaseOrderCreationError } from "@/lib/purchase-order-creation";

export async function POST(request: Request) {
  try {
    const auth = await getLinePurchasingUserFromRequest(request);
    if (!auth.ok) return auth.response;

    const vendor = String(auth.body.vendor ?? "").trim();
    const items = validatePurchaseOrderItems(auth.body.items);
    const note = String(auth.body.note ?? "").trim() || null;
    const expectedDate = auth.body.expected_date ? String(auth.body.expected_date) : null;
    const liffRequestId = String(auth.body.liffRequestId ?? "").trim();

    if (!vendor) return NextResponse.json({ error: "กรุณาเลือก Vendor" }, { status: 400 });
    if (!items) return NextResponse.json({ error: describeInvalidPurchaseOrderItems(auth.body.items) }, { status: 400 });

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
    await recordPurchaseOrderCommunication({ poId: Number(created.purchaseOrder.id), eventType: "PO_REVIEW_REQUIRED", actor: auth.user, source: "LIFF", metadata: { origin: "LAB" } });

    return NextResponse.json(fullPO, { status: 201 });
  } catch (error) {
    console.error("LIFF order create error:", error);
    if (error instanceof PurchaseOrderCreationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to submit purchase order from LINE." }, { status: 500 });
  }
}
