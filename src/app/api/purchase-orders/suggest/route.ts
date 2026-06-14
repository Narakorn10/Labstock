import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vendor = searchParams.get('vendor'); // Optional filter by vendor
    
    // Auto-suggest logic based on min_threshold and current quantity
    let query;
    if (vendor) {
      query = await sql`
        WITH InventorySummary AS (
          SELECT 
            item_id,
            SUM(quantity) as current_qty
          FROM inventory
          GROUP BY item_id
        )
        SELECT 
          m.item_id,
          m.name,
          m.unit,
          m.min_threshold,
          m.weekly_target,
          COALESCE(i.current_qty, 0) as quantity,
          GREATEST(0, (m.weekly_target * 4) - COALESCE(i.current_qty, 0)) as suggested_order_qty
        FROM master_data m
        LEFT JOIN InventorySummary i ON m.item_id = i.item_id
        WHERE COALESCE(i.current_qty, 0) <= m.min_threshold
        AND m.vendor = ${vendor}
      `;
    } else {
      query = await sql`
        WITH InventorySummary AS (
          SELECT 
            item_id,
            SUM(quantity) as current_qty
          FROM inventory
          GROUP BY item_id
        )
        SELECT 
          m.item_id,
          m.name,
          m.unit,
          m.vendor,
          m.min_threshold,
          m.weekly_target,
          COALESCE(i.current_qty, 0) as quantity,
          GREATEST(0, (m.weekly_target * 4) - COALESCE(i.current_qty, 0)) as suggested_order_qty
        FROM master_data m
        LEFT JOIN InventorySummary i ON m.item_id = i.item_id
        WHERE COALESCE(i.current_qty, 0) <= m.min_threshold
      `;
    }

    return NextResponse.json(query);
  } catch (error: any) {
    console.error('Error suggesting PO items:', error);
    return NextResponse.json({ error: 'Failed to suggest items' }, { status: 500 });
  }
}
