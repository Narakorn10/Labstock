import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { notifyUsers } from '@/lib/notifications';

const sql = neon(process.env.DATABASE_URL || '');

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    // Check if id is numeric or po_number
    let poData;
    if (!isNaN(Number(id))) {
      poData = await sql`SELECT * FROM purchase_orders WHERE id = ${id}`;
    } else {
      poData = await sql`SELECT * FROM purchase_orders WHERE po_number = ${id}`;
    }

    if (poData.length === 0) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    const po = poData[0];
    const items = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id}`;

    return NextResponse.json({ ...po, items });
  } catch (error: any) {
    console.error('Error fetching PO:', error);
    return NextResponse.json({ error: 'Failed to fetch purchase order' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, vendor_note } = body;

    let poData;
    if (!isNaN(Number(id))) {
      poData = await sql`SELECT * FROM purchase_orders WHERE id = ${id}`;
    } else {
      poData = await sql`SELECT * FROM purchase_orders WHERE po_number = ${id}`;
    }

    if (poData.length === 0) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    const po = poData[0];
    let updateQuery;

    if (status === 'CONFIRMED') {
      updateQuery = await sql`
        UPDATE purchase_orders 
        SET status = ${status}, vendor_note = ${vendor_note || po.vendor_note}, confirmed_at = NOW(), updated_at = NOW()
        WHERE id = ${po.id}
        RETURNING *
      `;
      
      // Notify lab admins
      const settings = await sql`SELECT * FROM notification_settings WHERE username = 'admin'`; // Simplification: notify admin user
      await notifyUsers('PO_CONFIRMED', updateQuery[0], settings);

    } else if (status === 'REJECTED') {
      updateQuery = await sql`
        UPDATE purchase_orders 
        SET status = ${status}, vendor_note = ${vendor_note || po.vendor_note}, updated_at = NOW()
        WHERE id = ${po.id}
        RETURNING *
      `;
    } else {
      updateQuery = await sql`
        UPDATE purchase_orders 
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${po.id}
        RETURNING *
      `;
    }

    const items = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id}`;
    return NextResponse.json({ ...updateQuery[0], items });

  } catch (error: any) {
    console.error('Error updating PO:', error);
    return NextResponse.json({ error: 'Failed to update purchase order' }, { status: 500 });
  }
}
