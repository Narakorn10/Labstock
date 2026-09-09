import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, normalizePurchaseOrder, notifyUsers } from "@/lib/notifications";
import { isLabPurchasingRole, validatePurchaseOrderItems } from "@/lib/purchase-order-workflow";
import { createPurchaseOrderWithAudit, PurchaseOrderCreationError } from "@/lib/purchase-order-creation";

async function getLabSettings() {
  const rows = await sql`
    SELECT n.*
    FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role IN ('Admin', 'Manager')
  `;
  return normalizeNotificationSettings(rows);
}

async function getManagerSettings() {
  const rows = await sql`
    SELECT n.*
    FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role = 'Manager'
  `;
  return normalizeNotificationSettings(rows);
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const requestedVendor = new URL(request.url).searchParams.get("vendor");
    const vendor = user.role === "Vendor" ? user.vendor : requestedVendor;
    if (user.role === "Vendor" && !vendor) {
      return NextResponse.json({ error: "Vendor profile is not configured" }, { status: 403 });
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

    return NextResponse.json(orders);
  } catch (error: unknown) {
    console.error("Error fetching purchase orders:", error);
    return NextResponse.json({ error: "Failed to fetch purchase orders" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const vendor = String(body.vendor ?? "").trim();
    const items = validatePurchaseOrderItems(body.items);
    const note = String(body.note ?? "").trim() || null;
    const expectedDate = body.expected_date || null;

    if (!vendor || !items) {
      return NextResponse.json({ error: "Vendor and valid order items are required" }, { status: 400 });
    }

    if (user.role === "Vendor" && user.vendor !== vendor) {
      return NextResponse.json({ error: "Vendor can only propose orders for its own company" }, { status: 403 });
    }
    if (user.role !== "Vendor" && !isLabPurchasingRole(user.role)) {
      return NextResponse.json({ error: "Only Admin, Manager, or the assigned Vendor can create an order" }, { status: 403 });
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

    await notifyUsers(
      "PO_REVIEW_REQUIRED",
      fullPO,
      origin === "VENDOR" ? await getLabSettings() : await getManagerSettings(),
    );
    return NextResponse.json(fullPO, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating purchase order:", error);
    if (error instanceof PurchaseOrderCreationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 });
  }
}
