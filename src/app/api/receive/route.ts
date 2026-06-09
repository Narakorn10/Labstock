import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { batchItems } = await request.json();
    
    // Capture Audit Info
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    const ipAddress = request.headers.get('x-forwarded-for') || 'Unknown';

    // Get item names for logging
    const masterData = await sql`SELECT item_id, name FROM master_data`;
    const itemNameMap: Record<string, string> = {};
    masterData.forEach(r => {
      itemNameMap[r.item_id.toLowerCase()] = r.name;
    });

    for (const item of batchItems) {
      const targetItemId = item.itemId.toString();
      const targetLotNo = item.lotNo.toString();
      const qty = parseFloat(item.qty);

      // Skip if quantity is 0 or less
      if (isNaN(qty) || qty <= 0) continue;

      const itemName = itemNameMap[targetItemId.toLowerCase()] || 'Unknown';
      const actor = user?.name ? `${user.name} (${user.role})` : 'เจ้าหน้าที่';
      
      // ALL-IN-ONE UPSERT + LOG
      await sql`
        WITH upserted AS (
          INSERT INTO inventory (item_id, lot_no, exp_date, quantity)
          VALUES (${targetItemId}, ${targetLotNo}, ${item.expDate}, ${qty})
          ON CONFLICT (item_id, lot_no) 
          DO UPDATE SET 
            quantity = inventory.quantity + ${qty},
            exp_date = EXCLUDED.exp_date
          RETURNING item_id, lot_no
        )
        INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address)
        SELECT item_id, ${itemName}, lot_no, 'รับเข้าสต๊อกหลัก', ${qty}, ${actor}, ${userAgent}, ${ipAddress}
        FROM upserted
      `;
    }

    return NextResponse.json({ success: true, message: `รับเข้าสำเร็จ ${batchItems.length} รายการ` });
  } catch (error: unknown) {
    console.error('Receive API Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
