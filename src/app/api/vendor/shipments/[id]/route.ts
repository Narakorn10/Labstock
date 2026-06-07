import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || (user.role !== 'Admin' && user.role !== 'Manager' && user.role !== 'User')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { action } = await request.json(); // 'receive' or 'cancel'

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

    // 2. ALL-IN-ONE ATOMIC OPERATION (CTE)
    // This handles: Status Update + Inventory Upsert + Log Entry
    // If any part fails, nothing is committed.
    const result = await sql`
      WITH claimed AS (
        UPDATE shipments 
        SET 
          status = 'Received', 
          received_at = CURRENT_TIMESTAMP, 
          received_by = ${user.name}
        WHERE id = ${id} AND status = 'In Transit'
        RETURNING *
      ),
      inv_update AS (
        INSERT INTO inventory (item_id, lot_no, exp_date, quantity)
        SELECT item_id, lot_no, exp_date, quantity FROM claimed
        ON CONFLICT (item_id, lot_no) 
        DO UPDATE SET 
          quantity = inventory.quantity + EXCLUDED.quantity,
          exp_date = EXCLUDED.exp_date
        RETURNING item_id, lot_no, quantity
      )
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username)
      SELECT item_id, ${shipment.reagent_name}, lot_no, 'รับเข้าจากบริษัท (Handshake)', quantity, ${user.name + ' (' + user.role + ')'}
      FROM inv_update
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'รายการนี้ถูกรับเข้าหรือยกเลิกไปก่อนหน้าแล้ว' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'รับเข้าสต๊อกสำเร็จ' });

  } catch (error: any) {
    console.error('Shipment PATCH Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
