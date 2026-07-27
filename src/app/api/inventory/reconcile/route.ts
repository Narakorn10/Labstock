import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Manager only' }, { status: 401 });
    }

    const body = await request.json();
    const inventoryId = Number(body.inventoryId);
    const itemId = String(body.itemId || '').trim();
    const newLotNo = String(body.newLotNo || '').trim();
    const newExpDate = body.newExpDate ? String(body.newExpDate).trim() : null;
    const newQty = Number(body.newQty);

    if (!Number.isInteger(inventoryId) || inventoryId <= 0 || !itemId || !newLotNo || Number.isNaN(newQty) || newQty < 0) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง' }, { status: 400 });
    }

    const targetRows = await sql`
      SELECT i.id, i.item_id, i.lot_no, i.received_on, m.name
      FROM inventory i
      LEFT JOIN master_data m ON LOWER(m.item_id) = LOWER(i.item_id)
      WHERE i.id = ${inventoryId}
        AND LOWER(i.item_id) = LOWER(${itemId})
      LIMIT 1
    `;

    if (targetRows.length === 0) {
      return NextResponse.json({ error: `ไม่พบรายการ ${itemId} ในสต๊อก` }, { status: 404 });
    }

    const targetRow = targetRows[0];
    const itemName = targetRow.name || 'Unknown';

    const duplicateLot = await sql`
      SELECT 1
      FROM inventory
      WHERE LOWER(item_id) = LOWER(${itemId})
        AND lot_no = ${newLotNo}
        AND received_on = ${targetRow.received_on}
        AND id <> ${inventoryId}
      LIMIT 1
    `;

    if (duplicateLot.length > 0) {
      return NextResponse.json(
        { error: `มี Lot ${newLotNo} สำหรับวันรับเข้านี้อยู่แล้วใน ${itemName}` },
        { status: 409 }
      );
    }

    const result = await sql`
      WITH updated AS (
        UPDATE inventory 
        SET
          lot_no = ${newLotNo},
          exp_date = ${newExpDate},
          quantity = ${newQty}
        WHERE id = ${inventoryId}
          AND LOWER(item_id) = LOWER(${itemId})
        RETURNING item_id, lot_no
      )
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username)
      SELECT item_id, ${itemName}, lot_no, 'ปรับปรุง lot/exp/qty (Reconciliation)', ${newQty}, ${user.name + ' (' + user.role + ')'}
      FROM updated
      RETURNING *
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: `ไม่พบรายการ ${itemName} ในสต๊อก` }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'ปรับ lot, expiry และยอดสต๊อกสำเร็จ' });
  } catch (error: unknown) {
    console.error('Reconcile API Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
