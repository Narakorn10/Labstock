import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireBarcodeLearningV2Access } from '@/lib/barcode-learning-auth';
import { mapBarcodeV2Row } from '@/lib/barcode-learning-v2';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBarcodeLearningV2Access(request);
  if (access.response || !access.user) return access.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return NextResponse.json({ error: 'กรุณาระบุเหตุผลก่อนปิดใช้รูปแบบ' }, { status: 400 });

    const current = await sql`SELECT * FROM barcode_pattern_v2 WHERE id = ${id} LIMIT 1`;
    if (!current.length) return NextResponse.json({ error: 'Pattern not found.' }, { status: 404 });
    const before = current[0] as Record<string, unknown>;
    if (before.status !== 'ACTIVE') return NextResponse.json({ error: 'Only an active pattern can be deactivated.' }, { status: 409 });

    const updatedRows = await sql`
      WITH current AS (
        SELECT p.*
        FROM barcode_pattern_v2 p
        WHERE p.id = ${id} AND p.status = 'ACTIVE'
        FOR UPDATE
      ), updated AS (
        UPDATE barcode_pattern_v2 p
        SET status = 'INACTIVE', deactivated_by = ${access.user.username}, deactivation_reason = ${reason},
            deactivated_at = NOW(), updated_by = ${access.user.username}, updated_at = NOW()
        FROM current
        WHERE p.id = current.id
        RETURNING p.*
      ), audit AS (
        INSERT INTO barcode_pattern_v2_audit (pattern_id, action, actor, reason, before_json, after_json)
        SELECT updated.id, 'DEACTIVATE', ${access.user.username}, ${reason}, to_jsonb(current), to_jsonb(updated)
        FROM updated
        INNER JOIN current ON current.id = updated.id
      )
      SELECT * FROM updated
    `;
    if (!updatedRows.length) return NextResponse.json({ error: 'Pattern changed before Deactivate completed.' }, { status: 409 });
    const after = updatedRows[0] as Record<string, unknown>;
    return NextResponse.json({ success: true, data: { pattern: mapBarcodeV2Row(after) }, message: 'ปิดใช้รูปแบบแล้ว' });
  } catch (error: unknown) {
    console.error('Barcode V2 deactivate error:', error);
    return NextResponse.json({ error: 'Unable to deactivate barcode pattern.' }, { status: 500 });
  }
}
