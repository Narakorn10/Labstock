import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isAdmin } from '@/lib/auth-utils';

export async function POST(request: Request) {
  try {
    // 1. Security Check: Must be enabled in environment AND user must be Admin
    if (process.env.ENABLE_RAW_QUERY !== 'true') {
      return NextResponse.json({ error: 'Feature disabled: Raw query is not allowed in this environment' }, { status: 403 });
    }

    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized: Admin only' }, { status: 401 });
    }

    const { query, params } = await request.json();

    if (!query) {
      return NextResponse.json({ error: 'Missing query string' }, { status: 400 });
    }

    // 2. Execute Query
    // Note: This is powerful but dangerous. Only for internal Admin use.
    const result = await sql.query(query, params || []);

    return NextResponse.json({
      success: true,
      data: result,
      rowCount: result.length
    });

  } catch (error: unknown) {
    console.error('Raw Query Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ 
      success: false, 
      error: errorMessage 
    }, { status: 500 });
  }
}
