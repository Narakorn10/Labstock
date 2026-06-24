import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { notifyUsers } from '@/lib/notifications';
import { getAuthenticatedUser } from '@/lib/auth-utils';

const sql = neon(process.env.DATABASE_URL || '');

// Helper to generate a PO number
async function generatePONumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const result = await sql`
    SELECT COUNT(*) as count 
    FROM purchase_orders 
    WHERE po_number LIKE ${'PO-' + dateStr + '-%'}
  `;
  const count = parseInt(result[0].count, 10) + 1;
  return `PO-${dateStr}-${count.toString().padStart(3, '0')}`;
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedVendor = searchParams.get('vendor');
    const vendor = user.role === 'Vendor' ? user.vendor : requestedVendor;
    
    let orders;
    if (user.role === 'Vendor') {
      if (!vendor) {
        return NextResponse.json({ error: 'Vendor profile is not configured' }, { status: 403 });
      }

      orders = await sql`
        SELECT * FROM purchase_orders 
        WHERE vendor = ${vendor} 
        ORDER BY created_at DESC
      `;
    } else if (vendor) {
      orders = await sql`
        SELECT * FROM purchase_orders 
        WHERE vendor = ${vendor} 
        ORDER BY created_at DESC
      `;
    } else {
      orders = await sql`
        SELECT * FROM purchase_orders 
        ORDER BY created_at DESC
      `;
    }

    // Optionally fetch items for each order
    // In a real app we might just fetch them when requested, but let's join or fetch separately
    const ordersWithItems = await Promise.all(orders.map(async (po) => {
      const items = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id}`;
      return { ...po, items };
    }));

    return NextResponse.json(ordersWithItems);
  } catch (error: any) {
    console.error('Error fetching POs:', error);
    return NextResponse.json({ error: 'Failed to fetch purchase orders' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role === 'Vendor') {
      return NextResponse.json({ error: 'Vendors cannot create purchase orders' }, { status: 403 });
    }

    const body = await request.json();
    const { vendor, note, expected_date, items } = body;

    if (!vendor || !items || items.length === 0) {
      return NextResponse.json({ error: 'Vendor and items are required' }, { status: 400 });
    }

    const poNumber = await generatePONumber();

    // Use a transaction conceptually (Neon supports transactions via array of queries, but for simplicity we can just execute sequentially)
    // Actually we can do it via a standard query block
    const poResult = await sql`
      INSERT INTO purchase_orders (po_number, vendor, note, expected_date, created_by, status)
      VALUES (${poNumber}, ${vendor}, ${note}, ${expected_date || null}, ${user.username}, 'SUBMITTED')
      RETURNING *
    `;

    const po = poResult[0];

    const itemsData = [];
    for (const item of items) {
      const itemRes = await sql`
        INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit)
        VALUES (${po.id}, ${item.item_id}, ${item.item_name}, ${item.quantity}, ${item.unit})
        RETURNING *
      `;
      itemsData.push(itemRes[0]);
    }

    const fullPO = { ...po, items: itemsData };

    // Fetch notification settings for the vendor to notify them
    // Assuming vendor user has username matching the vendor name or similar
    const settings = await sql`SELECT * FROM notification_settings WHERE username = ${vendor}`;
    await notifyUsers('PO_CREATED', fullPO, settings);

    return NextResponse.json(fullPO, { status: 201 });
  } catch (error: any) {
    console.error('Error creating PO:', error);
    return NextResponse.json({ error: 'Failed to create purchase order' }, { status: 500 });
  }
}
