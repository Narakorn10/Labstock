import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let shipments;
    if (user.role === 'Vendor') {
      // Vendors see only their own shipments
      shipments = await sql`
        SELECT s.*, m.name as reagent_name, m.unit
        FROM shipments s
        JOIN master_data m ON s.item_id = m.item_id
        WHERE s.vendor = ${user.company}
        ORDER BY s.created_at DESC
      `;
    } else {
      // Admins/Managers see all pending or recent shipments
      shipments = await sql`
        SELECT s.*, m.name as reagent_name, m.unit
        FROM shipments s
        JOIN master_data m ON s.item_id = m.item_id
        ORDER BY s.created_at DESC
      `;
    }

    return NextResponse.json(shipments);
  } catch (error: any) {
    console.error('Shipments GET Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.role !== 'Vendor') {
      return NextResponse.json({ error: 'Unauthorized: Vendors only' }, { status: 401 });
    }

    const { items, referenceNo } = await request.json();

    if (!items || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Invalid items data' }, { status: 400 });
    }

    let added = 0;
    for (const item of items) {
      // Validation: item_id must exist in master_data
      const master = await sql`SELECT item_id FROM master_data WHERE item_id = ${item.itemId} LIMIT 1`;
      if (master.length === 0) continue;

      await sql`
        INSERT INTO shipments (reference_no, vendor, item_id, lot_no, exp_date, quantity, status)
        VALUES (${referenceNo}, ${user.company}, ${item.itemId}, ${item.lotNo}, ${item.expDate}, ${item.qty}, 'In Transit')
      `;
      added++;
    }

    return NextResponse.json({ success: true, message: `แจ้งส่งสินค้าสำเร็จ ${added} รายการ` });
  } catch (error: any) {
    console.error('Shipments POST Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
