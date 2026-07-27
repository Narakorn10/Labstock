import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, normalizePurchaseOrder, notifyUsers } from "@/lib/notifications";
import type { ShipmentDraft } from "@/lib/shipment-ocr";

type ShipmentRequest = {
  poNumber?: string;
  referenceNo?: string;
  trackingNo?: string;
  trackingProvider?: string;
  deliveryDate?: string;
  sourceType?: "MANUAL" | "PDF_TEXT" | "AZURE_OCR";
  sourceFileName?: string;
  sourceFileHash?: string;
  items?: ShipmentDraft[];
};

function normalizedDate(value: unknown) {
  const text = String(value ?? "").trim().replace(/\./g, "-").replace(/\//g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) return null;
  return text;
}

function validateItems(items: unknown): ShipmentDraft[] | null {
  if (!Array.isArray(items) || !items.length) return null;
  const normalized = items.map((item) => ({
    itemId: String(item?.itemId ?? "").trim(), lotNo: String(item?.lotNo ?? "").trim(),
    expDate: normalizedDate(item?.expDate) ?? "", qty: Number(item?.qty),
    confidence: item?.confidence, mappingReason: String(item?.mappingReason ?? "").trim(),
  }));
  if (normalized.some((item) => !item.itemId || !item.lotNo || !item.expDate || !Number.isFinite(item.qty) || item.qty <= 0 || new Date(`${item.expDate}T00:00:00Z`) < new Date(new Date().toISOString().slice(0, 10)))) return null;
  return normalized;
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const shipments = user.role === "Vendor"
      ? await sql`SELECT s.*, m.name AS reagent_name, m.unit FROM shipments s JOIN master_data m ON s.item_id = m.item_id WHERE s.vendor = ${user.vendor} ORDER BY s.created_at DESC`
      : await sql`SELECT s.*, m.name AS reagent_name, m.unit FROM shipments s JOIN master_data m ON s.item_id = m.item_id ORDER BY s.created_at DESC`;
    return NextResponse.json(shipments);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load shipments" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.role !== "Vendor" || !user.vendor) return NextResponse.json({ error: "Unauthorized: Vendors only" }, { status: 401 });
    const body = await request.json() as ShipmentRequest;
    const poNumber = String(body.poNumber ?? "").trim();
    const referenceNo = String(body.referenceNo ?? "").trim();
    const items = validateItems(body.items);
    if (!poNumber || !referenceNo || !items) return NextResponse.json({ error: "Choose a confirmed order and complete item, lot, expiry, and positive quantity" }, { status: 400 });

    const poRows = await sql`SELECT * FROM purchase_orders WHERE po_number = ${poNumber} AND vendor = ${user.vendor} AND status IN ('CONFIRMED', 'PARTIALLY_SHIPPED') LIMIT 1`;
    if (!poRows.length) return NextResponse.json({ error: "This order is not eligible for shipment" }, { status: 409 });
    const po = poRows[0];
    const orderItems = await sql`
      SELECT poi.item_id, poi.quantity, COALESCE(SUM(s.quantity) FILTER (WHERE s.status <> 'Cancelled'), 0) AS shipped_qty
      FROM purchase_order_items poi
      LEFT JOIN shipments s ON s.po_number = ${poNumber} AND s.item_id = poi.item_id
      WHERE poi.po_id = ${po.id}
      GROUP BY poi.item_id, poi.quantity
    `;
    const requested = new Map<string, number>();
    items.forEach((item) => requested.set(item.itemId, (requested.get(item.itemId) ?? 0) + item.qty));
    const orderMap = new Map(orderItems.map((item) => [String(item.item_id), { ordered: Number(item.quantity), shipped: Number(item.shipped_qty) }]));
    if ([...requested.entries()].some(([itemId, qty]) => !orderMap.has(itemId) || qty > orderMap.get(itemId)!.ordered - orderMap.get(itemId)!.shipped)) {
      return NextResponse.json({ error: "Shipment quantity exceeds the remaining quantity on this order" }, { status: 409 });
    }

    const metadata = { type: body.sourceType === "AZURE_OCR" || body.sourceType === "PDF_TEXT" ? body.sourceType : "MANUAL", fileName: String(body.sourceFileName ?? "").slice(0, 255) || null, fileHash: String(body.sourceFileHash ?? "").slice(0, 128) || null };
    const databaseItems = items.map((item) => ({
      item_id: item.itemId, lot_no: item.lotNo, exp_date: item.expDate, qty: item.qty,
      confidence: item.confidence ?? "red", provenance: item.mappingReason || "Manual review",
    }));
    // One database statement keeps the batch, all lot rows, and PO status transition atomic.
    const saved = await sql`
      WITH new_batch AS (
        INSERT INTO shipment_batches (po_number, vendor, reference_no, delivery_date, tracking_no, tracking_provider, source_type, source_file_name, source_file_hash, created_by)
        VALUES (${poNumber}, ${user.vendor}, ${referenceNo}, ${normalizedDate(body.deliveryDate)}, ${String(body.trackingNo ?? "").trim() || null}, ${String(body.trackingProvider ?? "").trim() || null}, ${metadata.type}, ${metadata.fileName}, ${metadata.fileHash}, ${user.username})
        RETURNING id
      ), new_rows AS (
        INSERT INTO shipments (shipment_batch_id, reference_no, po_number, tracking_no, tracking_provider, vendor, item_id, lot_no, exp_date, quantity, status, mapping_confidence, mapping_provenance)
        SELECT new_batch.id, ${referenceNo}, ${poNumber}, ${String(body.trackingNo ?? "").trim() || null}, ${String(body.trackingProvider ?? "").trim() || null}, ${user.vendor}, input.item_id, input.lot_no, input.exp_date, input.qty, 'In Transit', input.confidence, input.provenance
        FROM new_batch, jsonb_to_recordset(${JSON.stringify(databaseItems)}::jsonb) AS input(item_id text, lot_no text, exp_date text, qty numeric, confidence text, provenance text)
        RETURNING id
      ), status_update AS (
        UPDATE purchase_orders p SET status = CASE WHEN NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi LEFT JOIN shipments s ON s.po_number = p.po_number AND s.item_id = poi.item_id AND s.status <> 'Cancelled'
          WHERE poi.po_id = p.id GROUP BY poi.id, poi.quantity HAVING COALESCE(SUM(s.quantity), 0) < poi.quantity
        ) THEN 'SHIPPED' ELSE 'PARTIALLY_SHIPPED' END, shipped_at = NOW(), updated_at = NOW()
        WHERE p.id = ${po.id} RETURNING status
      ) SELECT (SELECT count(*) FROM new_rows) AS shipment_count, (SELECT status FROM status_update) AS status
    `;
    const updatedPo = (await sql`SELECT * FROM purchase_orders WHERE id = ${po.id}`)[0];
    const settingsRows = await sql`SELECT * FROM notification_settings WHERE username = 'admin'`;
    await notifyUsers("PO_SHIPPED", normalizePurchaseOrder(updatedPo), normalizeNotificationSettings(settingsRows));
    return NextResponse.json({ success: true, data: { shipmentCount: Number(saved[0].shipment_count), status: saved[0].status }, message: "Shipment submitted for Lab receipt" }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit shipment" }, { status: 500 });
  }
}
