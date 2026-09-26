import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { recordPurchaseOrderCommunication } from "@/lib/po-communication";
import { getLinePurchasingUserFromRequest } from "@/lib/line-liff-ordering";
import { applyLabReviewDecision } from "@/lib/purchase-order-review";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getLinePurchasingUserFromRequest(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const requestedAction = String(auth.body.action ?? "");
    const legacyStatus = String(auth.body.status ?? "");
    const action = requestedAction || (legacyStatus === "CONFIRMED" ? "APPROVE_REVISION" : legacyStatus === "REJECTED" ? "REJECT_REVISION" : "");
    if (action !== "APPROVE_REVISION" && action !== "REJECT_REVISION") {
      return NextResponse.json({ error: "Only APPROVE_REVISION or REJECT_REVISION is allowed from LINE review." }, { status: 400 });
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
    if (po.status === "PENDING_LAB_REVIEW" && requestedAction) {
      return NextResponse.json({ error: "Revision actions are only valid after a Vendor requests a revision." }, { status: 409 });
    }

    const status = action === "APPROVE_REVISION" ? "CONFIRMED" : "REJECTED";
    const applied = await applyLabReviewDecision(sql, {
      po: { id: Number(po.id), status: po.status, confirmed_at: po.confirmed_at },
      decision: status,
      reviewer: auth.user.username,
    });
    if (!applied) return NextResponse.json({ error: "This order was already reviewed." }, { status: 409 });

    const updatedRows = await sql`SELECT * FROM purchase_orders WHERE id = ${po.id}`;
    const items = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`;
    await recordPurchaseOrderCommunication({ poId: Number(po.id), eventType: status === "CONFIRMED" ? "PO_CONFIRMED" : "PO_STATUS_UPDATED", actor: auth.user, source: "LIFF", metadata: { fromStatus: po.status } });

    return NextResponse.json({ ...updatedRows[0], items });
  } catch (error) {
    console.error("LIFF order review error:", error);
    return NextResponse.json({ error: "Unable to review purchase order from LINE." }, { status: 500 });
  }
}
