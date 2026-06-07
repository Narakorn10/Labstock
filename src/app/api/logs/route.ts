import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '200');
    const searchTerm = searchParams.get('search') || '';
    const action = searchParams.get('action') || '';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    // Base Query
    let query = sql`
      SELECT 
        id,
        timestamp,
        item_id as "itemId",
        name,
        lot_no as "lotNo",
        action,
        quantity as qty,
        username as user
      FROM logs
      WHERE 1=1
    `;

    // Add Filters dynamically (Note: for neon-serverless we can append to the template or use conditions)
    // To keep it simple and safe, we'll construct the query with conditional logic
    
    const data = await sql`
      SELECT 
        id,
        timestamp,
        item_id as "itemId",
        name,
        lot_no as "lotNo",
        action,
        quantity as qty,
        username as user
      FROM logs
      WHERE (name ILIKE ${'%' + searchTerm + '%'} OR item_id ILIKE ${'%' + searchTerm + '%'} OR lot_no ILIKE ${'%' + searchTerm + '%'})
      AND (${action === '' ? true : false} OR action = ${action})
      AND (${startDate ? true : false} = false OR timestamp >= ${startDate || '1970-01-01'})
      AND (${endDate ? true : false} = false OR timestamp <= ${endDate ? endDate + ' 23:59:59' : '9999-12-31'})
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Logs API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
