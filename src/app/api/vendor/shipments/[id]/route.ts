import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { recordPurchaseOrderCommunication } from "@/lib/po-communication";
import { recomputePurchaseOrderStatusQuery } from "@/lib/purchase-order-status";

function quantitiesMatch(total: number, accepted: number, rejected: number) {
  return Math.abs(accepted + rejected - total) < 0.000001;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || (user.role !== "Admin" && user.role !== "Manager")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json() as { action?: string; accepted_qty?: number; rejected_qty?: number; rejection_reason?: string };
    const action = body.action;
    const shipmentRows = await sql`
      SELECT s.*, m.name AS reagent_name
      FROM shipments s JOIN master_data m ON s.item_id = m.item_id
      WHERE s.id = ${id} LIMIT 1
    `;
    if (!shipmentRows.length) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    const shipment = shipmentRows[0];
    if (shipment.status !== "In Transit") return NextResponse.json({ error: "Shipment is already processed" }, { status: 400 });

    if (action === "cancel") {
      // The PO status is recomputed by a second statement so it sees the cancelled shipment.
      const [cancelled, recomputed] = await sql.transaction([sql`
        UPDATE shipments SET status = 'Cancelled'
        WHERE id = ${id} AND status = 'In Transit'
        RETURNING id AS shipment_id, po_number
      `, recomputePurchaseOrderStatusQuery(sql, shipment.po_number ?? null)]);
      if (!cancelled[0]?.shipment_id) return NextResponse.json({ error: "รายการนี้ถูกดำเนินการไปก่อนหน้าแล้ว" }, { status: 400 });
      if (recomputed[0]?.id) await recordPurchaseOrderCommunication({ poId: Number(recomputed[0].id), eventType: "PO_CANCELLED", actor: user, source: "WEB", shipmentId: Number(id), metadata: { reason: "Lab cancelled in-transit shipment" } });
      return NextResponse.json({ success: true, message: "ยกเลิกรายการสำเร็จ" });
    }

    const acceptedQty = body.accepted_qty === undefined ? Number(shipment.quantity) : Number(body.accepted_qty);
    const rejectedQty = body.rejected_qty === undefined ? 0 : Number(body.rejected_qty);
    const rejectionReason = String(body.rejection_reason ?? "").trim();
    if (!Number.isFinite(acceptedQty) || !Number.isFinite(rejectedQty) || acceptedQty < 0 || rejectedQty < 0 || !quantitiesMatch(Number(shipment.quantity), acceptedQty, rejectedQty)) {
      return NextResponse.json({ error: "จำนวนรับผ่าน/เสียไม่ถูกต้องหรือเกินจำนวนที่จัดส่ง" }, { status: 400 });
    }
    if (rejectedQty > 0 && !rejectionReason) return NextResponse.json({ error: "กรุณาระบุเหตุผลเมื่อมีของเสียหรือไม่ผ่าน" }, { status: 400 });

    // The PO status is recomputed by a second statement so it sees the updated accepted quantities.
    const [received] = await sql.transaction([sql`
      WITH claimed AS (
        UPDATE shipments
        SET status = 'Received', received_at = CURRENT_TIMESTAMP, received_by = ${user.name},
            accepted_qty = ${acceptedQty}, rejected_qty = ${rejectedQty}, rejection_reason = ${rejectionReason || null}
        WHERE id = ${id} AND status = 'In Transit'
        RETURNING *
      ), inv_update AS (
        INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on)
        SELECT item_id, lot_no, exp_date, ${acceptedQty}, CURRENT_DATE FROM claimed WHERE ${acceptedQty} > 0
        ON CONFLICT (item_id, lot_no, received_on)
        DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity, exp_date = EXCLUDED.exp_date
        RETURNING item_id, lot_no, quantity
      ), log_insert AS (
        INSERT INTO logs (item_id, name, lot_no, action, quantity, username)
        SELECT item_id, ${shipment.reagent_name}, lot_no, 'รับเข้าจากบริษัท (Handshake)', ${acceptedQty}, ${user.name + " (" + user.role + ")"}
        FROM inv_update
        RETURNING id
      ), po_item_update AS (
        UPDATE purchase_order_items poi
        SET received_qty = COALESCE(poi.received_qty, 0) + ${acceptedQty},
            accepted_qty = COALESCE(poi.accepted_qty, 0) + ${acceptedQty},
            rejected_qty = COALESCE(poi.rejected_qty, 0) + ${rejectedQty}
        FROM claimed c
        WHERE c.po_number IS NOT NULL AND poi.po_id = (SELECT p.id FROM purchase_orders p WHERE p.po_number = c.po_number)
          AND poi.item_id = c.item_id
        RETURNING poi.po_id
      )
      SELECT c.id AS shipment_id, c.po_number, c.rejected_qty, (SELECT po_id FROM po_item_update LIMIT 1) AS po_id
      FROM claimed c
    `, recomputePurchaseOrderStatusQuery(sql, shipment.po_number ?? null)]);
    if (!received.length) return NextResponse.json({ error: "รายการนี้ถูกรับเข้าหรือยกเลิกไปก่อนหน้าแล้ว" }, { status: 400 });
    const row = received[0];
    const poId = row.po_id ? Number(row.po_id) : null;
    if (poId) {
      await recordPurchaseOrderCommunication({
        poId,
        eventType: Number(row.rejected_qty) > 0 ? "SHIPMENT_REPLACEMENT_REQUIRED" : "PO_RECEIVED",
        actor: user,
        source: "WEB",
        shipmentId: Number(row.shipment_id),
        note: rejectionReason || null,
        metadata: { acceptedQty, rejectedQty, replacementRequired: rejectedQty > 0 },
      });
    }
    return NextResponse.json({ success: true, replacementRequired: rejectedQty > 0, message: rejectedQty > 0 ? "รับรายการแล้วและแจ้งให้ Vendor จัดส่งทดแทน" : "รับเข้าสต๊อกสำเร็จ" });
  } catch (error: unknown) {
    console.error("Shipment error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process shipment" }, { status: 500 });
  }
}
