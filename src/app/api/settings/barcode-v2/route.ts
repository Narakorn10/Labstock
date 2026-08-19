import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireBarcodeLearningV2Access } from '@/lib/barcode-learning-auth';
import {
  mapBarcodeV2Row,
  hasBarcodeV2AdvancedRegexInput,
  normalizeV2Payload,
  validateBarcodeV2Payload,
} from '@/lib/barcode-learning-v2';

export async function GET(request: Request) {
  const access = await requireBarcodeLearningV2Access(request);
  if (access.response) return access.response;
  try {
    const rows = await sql`SELECT * FROM barcode_pattern_v2 ORDER BY created_at DESC, id DESC`;
    return NextResponse.json(rows.map((row) => mapBarcodeV2Row(row as Record<string, unknown>)));
  } catch (error: unknown) {
    console.error('Barcode V2 GET error:', error);
    return NextResponse.json({ error: 'Unable to load V2 barcode patterns.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await requireBarcodeLearningV2Access(request);
  if (access.response) return access.response;
  if (!access.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    if (hasBarcodeV2AdvancedRegexInput(body) && access.user.role !== 'Admin') {
      return NextResponse.json({ error: 'Advanced Regex and capture groups require an Admin account.' }, { status: 403 });
    }
    const payload = normalizeV2Payload(body);
    if (!payload.name || payload.examples.length === 0) {
      return NextResponse.json({ error: 'Name and at least one barcode example are required.' }, { status: 400 });
    }

    const result = await validateBarcodeV2Payload(payload);
    const status = result.verification.status === 'VERIFIED' ? 'VERIFIED' : 'DRAFT';
    const rows = await sql`
      WITH created AS (
        INSERT INTO barcode_pattern_v2 (
          name, status, mapping_mode, fixed_item_id, regex_pattern,
          item_id_group, lot_no_group, exp_date_group, examples, verification,
          created_by, updated_by
        ) VALUES (
          ${payload.name}, ${status}, ${payload.mapping_mode}, ${payload.fixed_item_id || null},
          ${result.regex_pattern}, ${result.item_id_group}, ${result.lot_no_group}, ${result.exp_date_group},
          ${JSON.stringify(payload.examples)}::jsonb, ${JSON.stringify(result.verification)}::jsonb,
          ${access.user.username}, ${access.user.username}
        )
        RETURNING *
      ), audit AS (
        INSERT INTO barcode_pattern_v2_audit (pattern_id, action, actor, after_json)
        SELECT id, 'CREATE', ${access.user.username}, to_jsonb(created)
        FROM created
      )
      SELECT * FROM created
    `;
    const pattern = rows[0] as Record<string, unknown>;
    return NextResponse.json({ success: true, data: { pattern: mapBarcodeV2Row(pattern) } }, { status: 201 });
  } catch (error: unknown) {
    console.error('Barcode V2 POST error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
