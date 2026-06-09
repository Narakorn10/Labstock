import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    const { batchItems } = await request.json();
    
    // Capture Audit Info
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    const ipAddress = request.headers.get('x-forwarded-for') || 'Unknown';

    // Get master info for logging
    const masterData = await sql`SELECT item_id, name FROM master_data`;
    const masterMap: Record<string, string> = {};
    masterData.forEach(r => masterMap[r.item_id.toLowerCase()] = r.name);

    // 1. Process Updates with Single-Query Atomic Protection (CTE)
    for (const item of batchItems) {
      const targetItemId = item.itemId.toString();
      const targetLotNo = item.lotNo.toString();
      const qtyToSubtract = parseFloat(item.qty);
      
      // Skip if quantity is 0 or less
      if (isNaN(qtyToSubtract) || qtyToSubtract <= 0) continue;

      const itemName = masterMap[targetItemId.toLowerCase()] || 'Unknown';
      const actor = user ? `${user.name} (${user.role})` : 'System';

      // ALL-IN-ONE Query: Update inventory AND Insert Log only if update succeeds
      const result = await sql`
        WITH updated AS (
          UPDATE inventory 
          SET quantity = quantity - ${qtyToSubtract}
          WHERE LOWER(item_id) = LOWER(${targetItemId}) 
            AND lot_no = ${targetLotNo}
            AND quantity >= ${qtyToSubtract}
          RETURNING item_id, lot_no
        )
        INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address)
        SELECT item_id, ${itemName}, lot_no, 'เบิกไปหน้างาน', ${qtyToSubtract}, ${actor}, ${userAgent}, ${ipAddress}
        FROM updated
        RETURNING id
      `;

      if (result.length === 0) {
        // If 0 rows returned, it means the UPDATE part found no match or insufficient quantity
        return NextResponse.json({ 
          error: `เบิกไม่สำเร็จ: ${item.name} (Lot: ${item.lotNo}) มียอดไม่พอหรือถูกเบิกไปก่อนหน้าแล้ว` 
        }, { status: 400 });
      }
    }

    return NextResponse.json({ success: true, message: 'เบิกจ่ายสำเร็จ' });
  } catch (error: unknown) {
    console.error('Dispense API Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
