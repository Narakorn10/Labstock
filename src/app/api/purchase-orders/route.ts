import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { apiError, toApiError } from "@/lib/api-response";
import { getRequestId } from "@/lib/request-observability";
import type { ErrorCode } from "@/lib/errors";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizePurchaseOrder } from "@/lib/notifications";
import { recordPurchaseOrderCommunication } from "@/lib/po-communication";
import { describeInvalidPurchaseOrderItems, isLabPurchasingRole, validatePurchaseOrderItems } from "@/lib/purchase-order-workflow";
import { createPurchaseOrderWithAudit, PurchaseOrderCreationError } from "@/lib/purchase-order-creation";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId });
    if (user.role !== "Vendor" && !isLabPurchasingRole(user.role)) return apiError("FORBIDDEN", { requestId });

    const requestedVendor = new URL(request.url).searchParams.get("vendor");
    const vendor = user.role === "Vendor" ? user.vendor : requestedVendor;
    if (user.role === "Vendor" && !vendor) {
      return apiError("FORBIDDEN", { requestId, message: "ยังไม่ได้ตั้งค่าโปรไฟล์บริษัทของบัญชีนี้", hint: "แจ้งผู้ดูแลระบบให้ผูกบัญชีนี้กับบริษัทผู้ขาย" });
    }

    const orders = user.role === "Vendor"
      ? await sql`
          SELECT
            po.id,
            po.po_number,
            po.vendor,
            po.status,
            po.proposal_origin,
            po.vendor_note,
            po.expected_date,
            po.created_at,
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', poi.id,
                  'item_id', poi.item_id,
                  'item_name', poi.item_name,
                  'quantity', poi.quantity,
                  'unit', poi.unit,
                  'received_qty', poi.received_qty,
                  'reagent_type', COALESCE(poi.reagent_type, md.reagent_type),
                  'job_type', COALESCE(poi.job_type, md.job_type),
                  'machine_type', COALESCE(poi.machine_type, md.machine_type)
                ) ORDER BY poi.id
              )
              FROM purchase_order_items poi
              LEFT JOIN master_data md ON md.item_id = poi.item_id
              WHERE poi.po_id = po.id
            ), '[]'::jsonb) AS items
          FROM purchase_orders po
          WHERE po.vendor = ${vendor}
            AND po.status <> 'PENDING_MANAGER_REVIEW'
          ORDER BY po.created_at DESC
        `
      : vendor
        ? await sql`
            SELECT po.*,
              COALESCE((
                SELECT jsonb_agg(
                  to_jsonb(poi) || jsonb_build_object(
                    'reagent_type', COALESCE(poi.reagent_type, md.reagent_type),
                    'job_type', COALESCE(poi.job_type, md.job_type),
                    'machine_type', COALESCE(poi.machine_type, md.machine_type)
                  ) ORDER BY poi.id
                )
                FROM purchase_order_items poi
                LEFT JOIN master_data md ON md.item_id = poi.item_id
                WHERE poi.po_id = po.id
              ), '[]'::jsonb) AS items
            FROM purchase_orders po
            WHERE po.vendor = ${vendor}
            ORDER BY po.created_at DESC
          `
        : await sql`
            SELECT po.*,
              COALESCE((
                SELECT jsonb_agg(
                  to_jsonb(poi) || jsonb_build_object(
                    'reagent_type', COALESCE(poi.reagent_type, md.reagent_type),
                    'job_type', COALESCE(poi.job_type, md.job_type),
                    'machine_type', COALESCE(poi.machine_type, md.machine_type)
                  ) ORDER BY poi.id
                )
                FROM purchase_order_items poi
                LEFT JOIN master_data md ON md.item_id = poi.item_id
                WHERE poi.po_id = po.id
              ), '[]'::jsonb) AS items
            FROM purchase_orders po
            ORDER BY po.created_at DESC
          `;

    const response = NextResponse.json(orders);
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error: unknown) {
    return toApiError(error, requestId).response;
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId });

    const body = await request.json();
    const vendor = String(body.vendor ?? "").trim();
    const items = validatePurchaseOrderItems(body.items);
    const note = String(body.note ?? "").trim() || null;
    const expectedDate = body.expected_date || null;

    if (!vendor) return apiError("VALIDATION_FAILED", { requestId, message: "กรุณาเลือกบริษัท" });
    if (!items) return apiError("VALIDATION_FAILED", { requestId, message: describeInvalidPurchaseOrderItems(body.items) });

    if (user.role === "Vendor" && user.vendor !== vendor) {
      return apiError("FORBIDDEN", { requestId, message: "บัญชีผู้ขายเสนอใบสั่งซื้อได้เฉพาะของบริษัทตัวเองเท่านั้น" });
    }
    if (user.role !== "Vendor" && !isLabPurchasingRole(user.role)) {
      return apiError("FORBIDDEN", { requestId, message: "สร้างใบสั่งซื้อได้เฉพาะ Admin, Manager หรือผู้ขายที่ได้รับมอบหมาย" });
    }

    const origin = user.role === "Vendor" ? "VENDOR" : "LAB";
    const created = await createPurchaseOrderWithAudit({
      user,
      vendor,
      items,
      note,
      expectedDate,
      origin,
    });
    const fullPO = normalizePurchaseOrder(created.purchaseOrder, created.items.map((item) => ({
      item_name: String(item.item_name),
      quantity: Number(item.quantity),
      unit: String(item.unit),
    })));

    await recordPurchaseOrderCommunication({
      poId: Number(created.purchaseOrder.id),
      eventType: "PO_REVIEW_REQUIRED",
      actor: user,
      source: "WEB",
      metadata: { origin },
      note,
    });
    const response = NextResponse.json(fullPO, { status: 201 });
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error: unknown) {
    if (error instanceof PurchaseOrderCreationError) {
      // These messages are written in Thai for users (e.g. which item or why), so they are kept.
      console.error(`[api-error] ${requestId}:`, error);
      const code: ErrorCode = error.status === 404 ? "PO_NOT_FOUND" : error.status === 409 ? "PO_STATE_CONFLICT" : "VALIDATION_FAILED";
      return apiError(code, { requestId, status: error.status, message: error.message });
    }
    return toApiError(error, requestId).response;
  }
}
