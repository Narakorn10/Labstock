import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { normalizePurchaseOrder } from "@/lib/notifications";
import { recordPurchaseOrderCommunication } from "@/lib/po-communication";
import { describeInvalidPurchaseOrderItems, validatePurchaseOrderItems } from "@/lib/purchase-order-workflow";
import { getLinePurchasingUserFromRequest, purchaseOrderHasLiffRequestColumn } from "@/lib/line-liff-ordering";
import { createPurchaseOrderWithAudit, PurchaseOrderCreationError } from "@/lib/purchase-order-creation";
import { apiError } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { getRequestId } from "@/lib/request-observability";
import { andDept, departmentErrorResponse, getDepartmentScope } from "@/lib/scoped-db";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
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

    // The LINE user's own (default) department; legacy while departments are off. After the 400 checks above.
    const scope = await getDepartmentScope(auth.user);

    const hasLiffRequestColumn = await purchaseOrderHasLiffRequestColumn();
    if (hasLiffRequestColumn && liffRequestId) {
      const existing = await sql`
        SELECT * FROM purchase_orders
        WHERE liff_request_id = ${liffRequestId}${andDept(scope)}
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
      scope,
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
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    // e.g. PO_LETTERHEAD_MISSING (409): the department has no letterhead row. The body's `error` is the Thai text the LIFF page shows.
    if (error instanceof AppError) {
      return apiError(error.code, { requestId, message: error.userMessage, hint: error.hint });
    }
    return NextResponse.json({ error: "Unable to submit purchase order from LINE." }, { status: 500 });
  }
}
