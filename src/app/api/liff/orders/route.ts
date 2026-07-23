import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { normalizeNotificationSettings, normalizePurchaseOrder, notifyUsers } from "@/lib/notifications";
import { validatePurchaseOrderItems } from "@/lib/purchase-order-workflow";
import { generatePONumber, getLinePurchasingUserFromRequest, purchaseOrderHasLiffRequestColumn } from "@/lib/line-liff-ordering";

async function getVendorSettings(vendor: string) {
  const rows = await sql`
    SELECT n.*
    FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role = 'Vendor' AND u.vendor = ${vendor}
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

    const catalogRows = await Promise.all(items.map((item) => sql`
      SELECT item_id, name, unit
      FROM master_data
      WHERE item_id = ${item.item_id} AND vendor = ${vendor}
      LIMIT 1
    `));
    if (catalogRows.some((rows) => rows.length === 0)) {
      return NextResponse.json({ error: "Every item must belong to the selected Vendor." }, { status: 400 });
    }

    const poNumber = await generatePONumber();
    const poResult = hasLiffRequestColumn
      ? await sql`
        INSERT INTO purchase_orders (
          po_number, vendor, note, expected_date, created_by, status, proposal_origin, liff_request_id
        )
        VALUES (
          ${poNumber}, ${vendor}, ${note}, ${expectedDate}, ${auth.user.username}, 'SUBMITTED', 'LAB', ${liffRequestId || null}
        )
        RETURNING *
      `
      : await sql`
        INSERT INTO purchase_orders (
          po_number, vendor, note, expected_date, created_by, status, proposal_origin
        )
        VALUES (
          ${poNumber}, ${vendor}, ${note}, ${expectedDate}, ${auth.user.username}, 'SUBMITTED', 'LAB'
        )
        RETURNING *
      `;

    const po = poResult[0];
    const itemRows = await Promise.all(items.map((item, index) => sql`
      INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit)
      VALUES (${po.id}, ${item.item_id}, ${catalogRows[index][0].name}, ${item.quantity}, ${catalogRows[index][0].unit})
      RETURNING *
    `));

    const fullPO = normalizePurchaseOrder(po, itemRows.map((rows) => ({
      item_name: String(rows[0].item_name),
      quantity: Number(rows[0].quantity),
      unit: String(rows[0].unit),
    })));
    await notifyUsers("PO_CREATED", fullPO, await getVendorSettings(vendor));

    return NextResponse.json(fullPO, { status: 201 });
  } catch (error) {
    console.error("LIFF order create error:", error);
    return NextResponse.json({ error: "Unable to submit purchase order from LINE." }, { status: 500 });
  }
}
