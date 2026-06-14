import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isAdmin } from '@/lib/auth-utils';

export async function GET() {
  try {
    const patterns = await sql`
      SELECT id, name, regex_pattern, item_id_group, lot_no_group, exp_date_group
      FROM barcode_patterns
      ORDER BY created_at DESC
    `;
    return NextResponse.json(patterns);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, regex_pattern, item_id_group, lot_no_group, exp_date_group } = await request.json();

    if (!name || !regex_pattern) {
      return NextResponse.json({ error: 'Name and Regex Pattern are required' }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO barcode_patterns (name, regex_pattern, item_id_group, lot_no_group, exp_date_group)
      VALUES (${name}, ${regex_pattern}, ${item_id_group || null}, ${lot_no_group || null}, ${exp_date_group || null})
      RETURNING *
    `;

    return NextResponse.json({ success: true, message: 'บันทึกรูปแบบบาร์โค้ดสำเร็จ', data: result[0] });
  } catch (error: unknown) {
    console.error('Barcode Pattern POST Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    await sql`DELETE FROM barcode_patterns WHERE id = ${id}`;

    return NextResponse.json({ success: true, message: 'ลบรูปแบบสำเร็จ' });
  } catch (error: unknown) {
    console.error('Barcode Pattern DELETE Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
