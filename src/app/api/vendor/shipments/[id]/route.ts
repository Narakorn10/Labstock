import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';
import { normalizeNotificationSettings, normalizePurchaseOrder } from '@/lib/notifications';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json() as { action?: string; accepted_qty?: number; rejected_qty?: number; rejection_reason?: string };
    const action = body.action; // 'receive' or 'cancel'

    // 1. Get shipment details
    const shipmentRows = await sql`
      SELECT s.*, m.name as reagent_name 
      FROM shipments s
      JOIN master_data m ON s.item_id = m.item_id
      WHERE s.id = ${id}
      LIMIT 1
    `;

    if (shipmentRows.length === 0) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    }

    const shipment = shipmentRows[0];

    if (shipment.status !== 'In Transit') {
      return NextResponse.json({ error: 'Shipment is already processed' }, { status: 400 });
    }

    if (action === 'cancel') {
      const cancelResult = await sql`
        UPDATE shipments 
        SET status = 'Cancelled' 
        WHERE id = ${id} AND status = 'In Transit'
        RETURNING id
      `;
      if (cancelResult.length === 0) {
        return NextResponse.json({ error: 'รายการนี้ถูกดำเนินการไปก่อนหน้าแล้ว' }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: 'ยกเลิกรายการสำเร็จ' });
    }

    const acceptedQty = body.accepted_qty === undefined ? Number(shipment.quantity) : Number(body.accepted_qty);
    const rejectedQty = body.rejected_qty === undefined ? 0 : Number(body.rejected_qty);
    const rejectionReason = String(body.rejection_reason ?? '').trim();
    if (!Number.isFinite(acceptedQty) || !Number.isFinite(rejectedQty) || acceptedQty < 0 || rejectedQty < 0 || acceptedQty + rejectedQty !== Number(shipment.quantity)) {
      return NextResponse.json({ error: 'จำนวนรับผ่าน/เสียไม่ถูกต้องหรือเกินจำนวนที่จัดส่ง' }, { status: 400 });
    }
    if (rejectedQty > 0 && !rejectionReason) {
      return NextResponse.json({ error: 'กรุณาระบุเหตุผลเมื่อมีของเสียหรือไม่ผ่าน' }, { status: 400 });
    }

    // 2. Keep shipment, inventory, log, and PO counters in one transaction.
    // A separate query for the PO would allow inventory to commit while the
    // order remains stale if the second operation failed.
    const transactionQueries = [sql`
      WITH claimed AS (
        UPDATE shipments 
        SET 
          status = 'Received', 
          received_at = CURRENT_TIMESTAMP, 
          received_by = ${user.name},
          accepted_qty = ${acceptedQty},
          rejected_qty = ${rejectedQty},
          rejection_reason = ${rejectionReason || null}
        WHERE id = ${id} AND status = 'In Transit'
        RETURNING *
      ),
      inv_update AS (
        INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on)
        SELECT item_id, lot_no, exp_date, ${acceptedQty}, CURRENT_DATE FROM claimed WHERE ${acceptedQty} > 0
        ON CONFLICT (item_id, lot_no, received_on) 
        DO UPDATE SET 
          quantity = inventory.quantity + EXCLUDED.quantity,
          exp_date = EXCLUDED.exp_date
        RETURNING item_id, lot_no, quantity
      )
      , log_insert AS (INSERT INTO logs (item_id, name, lot_no, action, quantity, username)
      SELECT item_id, ${shipment.reagent_name}, lot_no, 'รับเข้าจากบริษัท (Handshake)', ${acceptedQty}, ${user.name + ' (' + user.role + ')'}
      FROM inv_update
      RETURNING id)
      SELECT id FROM claimed
    `];

    if (shipment.po_number) {
      const poData = await sql`SELECT id FROM purchase_orders WHERE po_number = ${shipment.po_number}`;
      if (poData.length > 0) {
        transactionQueries.push(sql`
          UPDATE purchase_order_items
          SET received_qty = COALESCE(received_qty, 0) + ${acceptedQty},
              accepted_qty = COALESCE(accepted_qty, 0) + ${acceptedQty},
              rejected_qty = COALESCE(rejected_qty, 0) + ${rejectedQty}
          WHERE po_id = ${poData[0].id} AND item_id = ${shipment.item_id}
        `);
        transactionQueries.push(sql`
          UPDATE purchase_orders p
          SET status = CASE WHEN NOT EXISTS (
            SELECT 1 FROM purchase_order_items poi
            WHERE poi.po_id = p.id
              AND COALESCE(poi.received_qty, 0) + COALESCE(poi.rejected_qty, 0) < poi.quantity
          ) THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END,
          received_at = NOW(), updated_at = NOW()
          WHERE id = ${poData[0].id}
        `);
      }
    }

    const [result] = await sql.transaction(transactionQueries);

    if (result.length === 0) {
      return NextResponse.json({ error: 'รายการนี้ถูกรับเข้าหรือยกเลิกไปก่อนหน้าแล้ว' }, { status: 400 });
    }

    if (shipment.po_number) {
      const poData = await sql`SELECT id FROM purchase_orders WHERE po_number = ${shipment.po_number}`;
      if (poData.length > 0) {
        const { notifyUsers } = await import('@/lib/notifications');
        const settingsRows = await sql`SELECT * FROM notification_settings WHERE username = ${shipment.vendor}`;
        const fullPoData = await sql`SELECT * FROM purchase_orders WHERE id = ${poData[0].id}`;
        const settings = normalizeNotificationSettings(settingsRows);
        await notifyUsers('PO_RECEIVED', normalizePurchaseOrder(fullPoData[0]), settings);
      }
    }

    return NextResponse.json({ success: true, message: 'รับเข้าสต๊อกสำเร็จ' });

  } catch (error: unknown) {
    console.error('Shipment error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
