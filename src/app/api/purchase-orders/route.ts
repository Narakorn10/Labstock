import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, normalizePurchaseOrder, notifyUsers } from "@/lib/notifications";
import { isLabPurchasingRole, validatePurchaseOrderItems } from "@/lib/purchase-order-workflow";

async function generatePONumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const result = await sql`
    SELECT COUNT(*) as count
    FROM purchase_orders
    WHERE po_number LIKE ${`PO-${dateStr}-%`}
  `;
  const count = Number(result[0]?.count ?? 0) + 1;
  return `PO-${dateStr}-${count.toString().padStart(3, "0")}`;
}

async function getVendorSettings(vendor: string) {
  const rows = await sql`
    SELECT n.*
    FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role = 'Vendor' AND u.vendor = ${vendor}
  `;
  return normalizeNotificationSettings(rows);
}

async function getLabSettings() {
  const rows = await sql`
    SELECT n.*
    FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role IN ('Admin', 'Manager')
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

    const orders = vendor
      ? await sql`SELECT * FROM purchase_orders WHERE vendor = ${vendor} ORDER BY created_at DESC`
      : await sql`SELECT * FROM purchase_orders ORDER BY created_at DESC`;
    const ordersWithItems = await Promise.all(orders.map(async (po) => ({
      ...po,
      items: await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`,
    })));

    return NextResponse.json(ordersWithItems);
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

    const catalogRows = await Promise.all(items.map((item) => sql`
      SELECT item_id, name, unit
      FROM master_data
      WHERE item_id = ${item.item_id} AND vendor = ${vendor}
      LIMIT 1
    `));
    if (catalogRows.some((rows) => rows.length === 0)) {
      return NextResponse.json({ error: "Every item must belong to the selected Vendor" }, { status: 400 });
    }

    const storedItems = items.map((item, index) => ({
      ...item,
      item_name: String(catalogRows[index][0].name),
      unit: String(catalogRows[index][0].unit),
    }));
    const origin = user.role === "Vendor" ? "VENDOR" : "LAB";
    const status = origin === "VENDOR" ? "PENDING_LAB_REVIEW" : "SUBMITTED";
    const poNumber = await generatePONumber();
    const poResult = await sql`
      INSERT INTO purchase_orders (
        po_number, vendor, note, expected_date, created_by, status, proposal_origin, review_requested_at
      )
      VALUES (
        ${poNumber}, ${vendor}, ${note}, ${expectedDate}, ${user.username}, ${status}, ${origin},
        ${origin === "VENDOR" ? new Date().toISOString() : null}
      )
      RETURNING *
    `;
    const po = poResult[0];
    const itemsData = await Promise.all(storedItems.map((item) => sql`
      INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit)
      VALUES (${po.id}, ${item.item_id}, ${item.item_name}, ${item.quantity}, ${item.unit})
      RETURNING *
    `));
    const fullPO = normalizePurchaseOrder(po, itemsData.map((rows) => ({
      item_name: String(rows[0].item_name),
      quantity: Number(rows[0].quantity),
      unit: String(rows[0].unit),
    })));

    await notifyUsers(origin === "VENDOR" ? "PO_REVIEW_REQUIRED" : "PO_CREATED", fullPO, origin === "VENDOR" ? await getLabSettings() : await getVendorSettings(vendor));
    return NextResponse.json(fullPO, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating purchase order:", error);
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 });
  }
}
