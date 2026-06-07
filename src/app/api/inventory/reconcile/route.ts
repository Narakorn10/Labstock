import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Manager only' }, { status: 401 });
    }

    const { itemId, lotNo, newQty } = await request.json();
    
    // Find reagent name
    const masterRows = await sql`
      SELECT name FROM master_data 
      WHERE LOWER(item_id) = LOWER(${itemId})
      LIMIT 1
    `;
    const itemName = masterRows.length > 0 ? masterRows[0].name : 'Unknown';

    // Update quantity and Log in one single Atomic Step (CTE)
    const result = await sql`
      WITH updated AS (
        UPDATE inventory 
        SET quantity = ${newQty}
        WHERE LOWER(item_id) = LOWER(${itemId}) AND lot_no = ${lotNo}
        RETURNING item_id, lot_no
      )
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username)
      SELECT item_id, ${itemName}, lot_no, 'ปรับปรุงยอดสต๊อก (Reconciliation)', ${newQty}, ${user.name + ' (' + user.role + ')'}
      FROM updated
      RETURNING *
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: `ไม่พบรายการ ${itemName} Lot: ${lotNo} ในสต๊อก` }, { status: 404 });
    }

    // Note: If I wanted to add 'remarks' as in the original, I might need to update the schema
    // But for now, I'll stick to the current schema.

    return NextResponse.json({ success: true, message: 'ปรับยอดสต๊อกสำเร็จ' });
  } catch (error: any) {
    console.error('Reconcile API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
