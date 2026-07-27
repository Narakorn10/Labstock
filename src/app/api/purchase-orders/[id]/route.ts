import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, normalizePurchaseOrder, notifyUsers } from "@/lib/notifications";
import { isLabPurchasingRole, validatePurchaseOrderItems } from "@/lib/purchase-order-workflow";

async function findPurchaseOrder(id: string) {
  return Number.isInteger(Number(id))
    ? sql`SELECT * FROM purchase_orders WHERE id = ${id}`
    : sql`SELECT * FROM purchase_orders WHERE po_number = ${id}`;
}

async function getLabSettings() {
  const rows = await sql`
    SELECT n.* FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role IN ('Admin', 'Manager')
  `;
  return normalizeNotificationSettings(rows);
}

async function getVendorSettings(vendor: string) {
  const rows = await sql`
    SELECT n.* FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role = 'Vendor' AND u.vendor = ${vendor}
  `;
  return normalizeNotificationSettings(rows);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const poData = await findPurchaseOrder(id);
    if (poData.length === 0) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

    const po = poData[0];
    if (user.role === "Vendor" && po.vendor !== user.vendor) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const items = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`;
    return NextResponse.json({ ...po, items });
  } catch (error: unknown) {
    console.error("Error fetching purchase order:", error);
    return NextResponse.json({ error: "Failed to fetch purchase order" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const status = String(body.status ?? "");
    const note = String(body.vendor_note ?? body.note ?? "").trim();
    const poData = await findPurchaseOrder(id);
    if (poData.length === 0) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

    const po = poData[0];
    const isVendor = user.role === "Vendor";
    const isLab = isLabPurchasingRole(user.role);
    if ((!isVendor && !isLab) || (isVendor && po.vendor !== user.vendor)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let recipientSettings;
    let notificationEvent: "PO_REVIEW_REQUIRED" | "PO_CONFIRMED" | "PO_STATUS_UPDATED";
    if (isVendor) {
      const canConfirmLabOrder = po.proposal_origin === "LAB" && po.status === "SUBMITTED" && status === "CONFIRMED";
      const canReviseLabOrder = po.proposal_origin === "LAB" && po.status === "SUBMITTED" && status === "REVISION_REQUESTED";
      if (!canConfirmLabOrder && !canReviseLabOrder) {
        return NextResponse.json({ error: "Vendor can only confirm or revise a submitted Lab order" }, { status: 409 });
      }

      if (canReviseLabOrder) {
        const revisedItems = validatePurchaseOrderItems(body.items);
        if (!revisedItems || !note) {
          return NextResponse.json({ error: "Revised items and a vendor note are required" }, { status: 400 });
        }
        const catalogRows = await Promise.all(revisedItems.map((item) => sql`
          SELECT item_id, name, unit FROM master_data
          WHERE item_id = ${item.item_id} AND vendor = ${po.vendor} LIMIT 1
        `));
        if (catalogRows.some((rows) => rows.length === 0)) {
          return NextResponse.json({ error: "Every revised item must belong to this Vendor" }, { status: 400 });
        }
        await sql`DELETE FROM purchase_order_items WHERE po_id = ${po.id}`;
        await Promise.all(revisedItems.map((item, index) => sql`
          INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit)
          VALUES (${po.id}, ${item.item_id}, ${catalogRows[index][0].name}, ${item.quantity}, ${catalogRows[index][0].unit})
        `));
      }

      await sql`
        UPDATE purchase_orders
        SET status = ${status}, vendor_note = ${note || po.vendor_note},
            review_requested_at = ${status === "REVISION_REQUESTED" ? new Date().toISOString() : po.review_requested_at},
            confirmed_at = ${status === "CONFIRMED" ? new Date().toISOString() : po.confirmed_at},
            updated_at = NOW()
        WHERE id = ${po.id}
      `;
      recipientSettings = await getLabSettings();
      notificationEvent = status === "REVISION_REQUESTED" ? "PO_REVIEW_REQUIRED" : "PO_CONFIRMED";
    } else {
      const awaitingLabReview = po.status === "PENDING_LAB_REVIEW" || po.status === "REVISION_REQUESTED";
      if (!awaitingLabReview || (status !== "CONFIRMED" && status !== "REJECTED")) {
        return NextResponse.json({ error: "Lab can only confirm or reject an order awaiting Lab review" }, { status: 409 });
      }
      await sql`
        UPDATE purchase_orders
        SET status = ${status}, reviewed_at = NOW(), reviewed_by = ${user.username},
            confirmed_at = ${status === "CONFIRMED" ? new Date().toISOString() : po.confirmed_at},
            updated_at = NOW()
        WHERE id = ${po.id}
      `;
      recipientSettings = await getVendorSettings(String(po.vendor));
      notificationEvent = status === "CONFIRMED" ? "PO_CONFIRMED" : "PO_STATUS_UPDATED";
    }

    const updatedRows = await sql`SELECT * FROM purchase_orders WHERE id = ${po.id}`;
    const items = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`;
    const fullPO = normalizePurchaseOrder(updatedRows[0], items.map((item) => ({
      item_name: String(item.item_name), quantity: Number(item.quantity), unit: String(item.unit),
    })));
    await notifyUsers(notificationEvent, fullPO, recipientSettings);
    return NextResponse.json({ ...updatedRows[0], items });
  } catch (error: unknown) {
    console.error("Error updating purchase order:", error);
    return NextResponse.json({ error: "Failed to update purchase order" }, { status: 500 });
  }
}
