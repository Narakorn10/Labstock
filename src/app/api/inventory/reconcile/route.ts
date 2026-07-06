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
    const itemId = String(body.itemId || '').trim();
    const currentLotNo = String(body.currentLotNo || '').trim();
    const newLotNo = String(body.newLotNo || '').trim();
    const newExpDate = body.newExpDate ? String(body.newExpDate).trim() : null;
    const newQty = Number(body.newQty);

    if (!itemId || !currentLotNo || !newLotNo || Number.isNaN(newQty) || newQty < 0) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง' }, { status: 400 });
    }
    
    // Find reagent name
    const masterRows = await sql`
      SELECT name FROM master_data 
      WHERE LOWER(item_id) = LOWER(${itemId})
      LIMIT 1
    `;
    const itemName = masterRows.length > 0 ? masterRows[0].name : 'Unknown';

    if (currentLotNo !== newLotNo) {
      const duplicateLot = await sql`
        SELECT 1
        FROM inventory
        WHERE LOWER(item_id) = LOWER(${itemId})
          AND lot_no = ${newLotNo}
        LIMIT 1
      `;

      if (duplicateLot.length > 0) {
        return NextResponse.json(
          { error: `มี Lot ${newLotNo} อยู่แล้วสำหรับ ${itemName}` },
          { status: 409 }
        );
      }
    }

    // Update quantity and Log in one single Atomic Step (CTE)
    const result = await sql`
      WITH updated AS (
        UPDATE inventory 
        SET
          lot_no = ${newLotNo},
          exp_date = ${newExpDate},
          quantity = ${newQty}
        WHERE LOWER(item_id) = LOWER(${itemId}) AND lot_no = ${currentLotNo}
        RETURNING item_id, lot_no
      )
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username)
      SELECT item_id, ${itemName}, lot_no, 'ปรับปรุง lot/exp/qty (Reconciliation)', ${newQty}, ${user.name + ' (' + user.role + ')'}
      FROM updated
      RETURNING *
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: `ไม่พบรายการ ${itemName} Lot: ${currentLotNo} ในสต๊อก` }, { status: 404 });
    }

    // Note: If I wanted to add 'remarks' as in the original, I might need to update the schema
    // But for now, I'll stick to the current schema.

    return NextResponse.json({ success: true, message: 'ปรับ lot, expiry และยอดสต๊อกสำเร็จ' });
  } catch (error: unknown) {
    console.error('Reconcile API Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
