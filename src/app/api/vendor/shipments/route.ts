import crypto from "node:crypto";
import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { recordPurchaseOrderCommunication } from "@/lib/po-communication";
import { recomputePurchaseOrderStatusQuery } from "@/lib/purchase-order-status";
import { describeShelfLifeViolations, findShelfLifeViolations, loadMinShelfLifeRules, SHELF_LIFE_BELOW_MINIMUM } from "@/lib/shelf-life";
import type { ShipmentDraft } from "@/lib/shipment-ocr";

type ShipmentRequest = {
  poNumber?: string;
  referenceNo?: string;
  trackingNo?: string;
  trackingProvider?: string;
  deliveryDate?: string;
  clientRequestId?: string;
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
    if (user.role !== "Vendor" && user.role !== "Admin" && user.role !== "Manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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

    // Lots below the Lab's minimum remaining shelf life are not accepted for shipment.
    const shelfLifeRules = await loadMinShelfLifeRules(sql, items.map((item) => item.itemId));
    const shortDated = findShelfLifeViolations(items, shelfLifeRules);
    if (shortDated.length) {
      return NextResponse.json({
        error: `Remaining shelf life is below the Lab minimum: ${describeShelfLifeViolations(shortDated)}`,
        code: SHELF_LIFE_BELOW_MINIMUM,
        lots: shortDated,
      }, { status: 409 });
    }

    const clientRequestId = String(body.clientRequestId ?? "").trim().slice(0, 128) || null;
    const requestFingerprint = crypto.createHash("sha256").update(JSON.stringify({ poNumber, referenceNo, items })).digest("hex");
    const metadata = {
      type: body.sourceType === "AZURE_OCR" || body.sourceType === "PDF_TEXT" ? body.sourceType : "MANUAL",
      fileName: String(body.sourceFileName ?? "").slice(0, 255) || null,
      fileHash: String(body.sourceFileHash ?? "").slice(0, 128) || null,
    };
    const databaseItems = items.map((item) => ({
      item_id: item.itemId, lot_no: item.lotNo, exp_date: item.expDate, qty: item.qty,
      confidence: item.confidence ?? "red", provenance: item.mappingReason || "Manual review",
    }));

    // Lock, remaining-quantity check, idempotency guard, and insert are one statement. The PO status
    // is recomputed by a second statement in the same transaction so it sees the new shipment rows.
    const [saved, recomputed] = await sql.transaction([sql`
      WITH lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`${user.vendor}:${poNumber}`})) AS locked
      ), existing AS (
        SELECT id, po_number FROM shipment_batches, lock
        WHERE vendor = ${user.vendor}
          AND ((${clientRequestId}::text IS NOT NULL AND client_request_id = ${clientRequestId})
            OR (${clientRequestId}::text IS NULL AND request_fingerprint = ${requestFingerprint}))
        LIMIT 1
      ), po AS (
        SELECT p.* FROM purchase_orders p, lock
        WHERE p.po_number = ${poNumber} AND p.vendor = ${user.vendor}
          AND p.status IN ('CONFIRMED', 'PARTIALLY_SHIPPED', 'PARTIALLY_RECEIVED')
        FOR UPDATE
      ), order_items AS (
        SELECT poi.item_id, poi.quantity,
          COALESCE(SUM(CASE WHEN s.status = 'In Transit' THEN s.quantity WHEN s.status = 'Received' THEN COALESCE(s.accepted_qty, 0) ELSE 0 END), 0) AS committed_qty
        FROM purchase_order_items poi
        LEFT JOIN shipments s ON s.po_number = ${poNumber} AND s.item_id = poi.item_id AND s.status <> 'Cancelled'
        WHERE poi.po_id = (SELECT id FROM po)
        GROUP BY poi.item_id, poi.quantity
      ), requested AS (
        SELECT item_id, SUM(qty)::numeric AS qty
        FROM jsonb_to_recordset(${JSON.stringify(databaseItems)}::jsonb) AS input(item_id text, lot_no text, exp_date text, qty numeric, confidence text, provenance text)
        GROUP BY item_id
      ), checked AS (
        SELECT labstock_assert(
          EXISTS (SELECT 1 FROM po)
          AND NOT EXISTS (
            SELECT 1 FROM requested r
            LEFT JOIN order_items oi ON oi.item_id = r.item_id
            WHERE oi.item_id IS NULL OR r.qty > (oi.quantity - oi.committed_qty)
          ),
          CASE WHEN NOT EXISTS (SELECT 1 FROM po) THEN 'SHIPMENT_ORDER_NOT_ELIGIBLE' ELSE 'SHIPMENT_QUANTITY_EXCEEDED' END
        ) AS ok
      ), new_batch AS (
        INSERT INTO shipment_batches
          (po_number, vendor, reference_no, delivery_date, tracking_no, tracking_provider, source_type, source_file_name, source_file_hash, created_by, client_request_id, request_fingerprint)
        SELECT ${poNumber}, ${user.vendor}, ${referenceNo}, ${normalizedDate(body.deliveryDate)}, ${String(body.trackingNo ?? "").trim() || null}, ${String(body.trackingProvider ?? "").trim() || null}, ${metadata.type}, ${metadata.fileName}, ${metadata.fileHash}, ${user.username}, ${clientRequestId}, ${requestFingerprint}
        FROM checked
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id, po_number
      ), new_rows AS (
        INSERT INTO shipments (shipment_batch_id, reference_no, po_number, tracking_no, tracking_provider, vendor, item_id, lot_no, exp_date, quantity, status, mapping_confidence, mapping_provenance)
        SELECT new_batch.id, ${referenceNo}, ${poNumber}, ${String(body.trackingNo ?? "").trim() || null}, ${String(body.trackingProvider ?? "").trim() || null}, ${user.vendor}, input.item_id, input.lot_no, input.exp_date, input.qty, 'In Transit', input.confidence, input.provenance
        FROM new_batch, jsonb_to_recordset(${JSON.stringify(databaseItems)}::jsonb) AS input(item_id text, lot_no text, exp_date text, qty numeric, confidence text, provenance text)
        RETURNING id
      ), shipped_update AS (
        UPDATE purchase_orders p SET shipped_at = NOW(), updated_at = NOW()
        WHERE p.id = (SELECT id FROM po) AND EXISTS (SELECT 1 FROM new_batch)
        RETURNING id
      )
      SELECT COALESCE((SELECT id FROM new_batch), (SELECT id FROM existing)) AS batch_id,
        (SELECT COUNT(*) FROM new_rows)::int AS shipment_count,
        (SELECT status FROM po) AS status,
        (SELECT id FROM shipped_update) AS po_id,
        EXISTS (SELECT 1 FROM existing) AS duplicate
    `, recomputePurchaseOrderStatusQuery(sql, poNumber)]);
    const result = saved[0] as Record<string, unknown> | undefined;
    if (result) result.status = recomputed[0]?.status ?? result.status;
    if (!result?.batch_id) return NextResponse.json({ error: "This order is not eligible for shipment" }, { status: 409 });
    if (result.duplicate) return NextResponse.json({ success: true, duplicate: true, data: { batchId: Number(result.batch_id), shipmentCount: 0, status: result.status }, message: "Shipment request was already accepted" });
    const poId = Number(result.po_id);
    if (poId) await recordPurchaseOrderCommunication({ poId, eventType: "PO_SHIPPED", actor: user, source: "WEB", metadata: { requestFingerprint } });
    return NextResponse.json({ success: true, data: { batchId: Number(result.batch_id), shipmentCount: Number(result.shipment_count), status: result.status }, message: "Shipment submitted for Lab receipt" }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to submit shipment";
    if (message.includes("SHIPMENT_QUANTITY_EXCEEDED")) return NextResponse.json({ error: "Shipment quantity exceeds the remaining quantity on this order" }, { status: 409 });
    if (message.includes("SHIPMENT_ORDER_NOT_ELIGIBLE")) return NextResponse.json({ error: "This order is not eligible for shipment" }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
