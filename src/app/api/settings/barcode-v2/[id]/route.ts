import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireBarcodeLearningV2Access } from '@/lib/barcode-learning-auth';
import {
  hasBarcodeV2AdvancedRegexInput,
  mapBarcodeV2Row,
  normalizeV2Payload,
  validateBarcodeV2Payload,
} from '@/lib/barcode-learning-v2';

async function findPattern(id: string) {
  const rows = await sql`SELECT * FROM barcode_pattern_v2 WHERE id = ${id} LIMIT 1`;
  return rows[0] as Record<string, unknown> | undefined;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBarcodeLearningV2Access(request);
  if (access.response) return access.response;
  const { id } = await params;
  try {
    const row = await findPattern(id);
    return row ? NextResponse.json(mapBarcodeV2Row(row)) : NextResponse.json({ error: 'Pattern not found.' }, { status: 404 });
  } catch (error: unknown) {
    console.error('Barcode V2 detail error:', error);
    return NextResponse.json({ error: 'Unable to load barcode pattern.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBarcodeLearningV2Access(request);
  if (access.response || !access.user) return access.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const before = await findPattern(id);
    if (!before) return NextResponse.json({ error: 'Pattern not found.' }, { status: 404 });
    if (before.status === 'ACTIVE') return NextResponse.json({ error: 'Deactivate an active pattern before editing it.' }, { status: 409 });

    const body = await request.json();
    if (hasBarcodeV2AdvancedRegexInput(body) && access.user.role !== 'Admin') {
      return NextResponse.json({ error: 'Advanced Regex and capture groups require an Admin account.' }, { status: 403 });
    }
    const payload = normalizeV2Payload(body);
    const result = await validateBarcodeV2Payload(payload);
    const status = result.verification.status === 'VERIFIED' ? 'VERIFIED' : 'DRAFT';
    const rows = await sql`
      WITH current AS (
        SELECT p.*
        FROM barcode_pattern_v2 p
        WHERE p.id = ${id}
          AND p.status <> 'ACTIVE'
          AND p.updated_at = ${before.updated_at}
        FOR UPDATE
      ), updated AS (
        UPDATE barcode_pattern_v2 p
        SET name = ${payload.name}, status = ${status}, mapping_mode = ${payload.mapping_mode},
            fixed_item_id = ${payload.fixed_item_id || null}, regex_pattern = ${result.regex_pattern},
            item_id_group = ${result.item_id_group}, lot_no_group = ${result.lot_no_group},
            exp_date_group = ${result.exp_date_group}, examples = ${JSON.stringify(payload.examples)}::jsonb,
            verification = ${JSON.stringify(result.verification)}::jsonb,
            updated_by = ${access.user.username}, updated_at = NOW()
        FROM current
        WHERE p.id = current.id
        RETURNING p.*
      ), audit AS (
        INSERT INTO barcode_pattern_v2_audit (pattern_id, action, actor, before_json, after_json)
        SELECT updated.id, 'UPDATE', ${access.user.username}, to_jsonb(current), to_jsonb(updated)
        FROM updated
        INNER JOIN current ON current.id = updated.id
      )
      SELECT updated.* FROM updated
    `;
    if (!rows.length) return NextResponse.json({ error: 'Pattern changed before update completed.' }, { status: 409 });
    const after = rows[0] as Record<string, unknown>;
    return NextResponse.json({ success: true, data: { pattern: mapBarcodeV2Row(after) } });
  } catch (error: unknown) {
    console.error('Barcode V2 PATCH error:', error);
    return NextResponse.json({ error: 'Unable to update barcode pattern.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBarcodeLearningV2Access(request);
  if (access.response || !access.user) return access.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const before = await findPattern(id);
    if (!before) return NextResponse.json({ error: 'Pattern not found.' }, { status: 404 });
    if (before.status === 'ACTIVE' || before.activated_at) {
      return NextResponse.json({ error: 'An active or previously active pattern cannot be permanently deleted.' }, { status: 409 });
    }
    const deletedRows = await sql`
      WITH deleted AS (
        DELETE FROM barcode_pattern_v2
        WHERE id = ${id} AND activated_at IS NULL AND status <> 'ACTIVE'
        RETURNING *
      ), audit AS (
        INSERT INTO barcode_pattern_v2_audit (pattern_id, action, actor, before_json)
        SELECT id, 'DELETE', ${access.user.username}, to_jsonb(deleted)
        FROM deleted
      )
      SELECT * FROM deleted
    `;
    if (!deletedRows.length) return NextResponse.json({ error: 'Pattern changed before delete completed.' }, { status: 409 });
    return NextResponse.json({ success: true, message: 'ลบฉบับร่างแล้ว' });
  } catch (error: unknown) {
    console.error('Barcode V2 DELETE error:', error);
    return NextResponse.json({ error: 'Unable to delete barcode pattern.' }, { status: 500 });
  }
}
