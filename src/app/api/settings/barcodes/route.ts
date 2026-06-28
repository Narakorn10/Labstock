import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isAdmin } from '@/lib/auth-utils';
import { processAnyBarcode } from '@/lib/barcode-parser';

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toGroupIndex(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const groupIndex = Number(value);
  return Number.isInteger(groupIndex) && groupIndex > 0 ? groupIndex : NaN;
}

function validateGroup(match: RegExpMatchArray, groupIndex: number | null, label: string, required = false) {
  if (!groupIndex) {
    if (required) return `${label} group is required.`;
    return '';
  }

  if (groupIndex >= match.length) {
    return `${label} group ${groupIndex} is outside the regex capture groups.`;
  }

  if (!String(match[groupIndex] || '').trim()) {
    return `${label} group ${groupIndex} did not capture a value from the sample barcode.`;
  }

  return '';
}

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

    const body = await request.json();
    const name = toText(body.name);
    const regexPattern = toText(body.regex_pattern);
    const sampleBarcode = toText(body.sample_barcode);
    const itemIdGroup = toGroupIndex(body.item_id_group);
    const lotNoGroup = toGroupIndex(body.lot_no_group);
    const expDateGroup = toGroupIndex(body.exp_date_group);

    if (!name || !regexPattern) {
      return NextResponse.json({ error: 'Name and Regex Pattern are required' }, { status: 400 });
    }

    if (!sampleBarcode) {
      return NextResponse.json({ error: 'Sample barcode is required before saving a custom pattern.' }, { status: 400 });
    }

    if ([itemIdGroup, lotNoGroup, expDateGroup].some(Number.isNaN)) {
      return NextResponse.json({ error: 'Capture group indexes must be positive numbers.' }, { status: 400 });
    }

    if (processAnyBarcode(sampleBarcode, [])?.barcodeType === 'GS1_COMPLIANT') {
      return NextResponse.json(
        { error: 'This sample is already supported by the GS1/UDI parser. Do not save a duplicate custom pattern.' },
        { status: 409 }
      );
    }

    let regex: RegExp;
    try {
      regex = new RegExp(regexPattern);
    } catch {
      return NextResponse.json({ error: 'Regex Pattern is invalid.' }, { status: 400 });
    }

    const match = sampleBarcode.match(regex);
    if (!match) {
      return NextResponse.json({ error: 'Regex Pattern does not match the sample barcode.' }, { status: 400 });
    }

    const groupError =
      validateGroup(match, itemIdGroup, 'Item ID', true) ||
      validateGroup(match, lotNoGroup, 'Lot No') ||
      validateGroup(match, expDateGroup, 'Exp Date');

    if (groupError) {
      return NextResponse.json({ error: groupError }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO barcode_patterns (name, regex_pattern, item_id_group, lot_no_group, exp_date_group)
      VALUES (${name}, ${regexPattern}, ${itemIdGroup}, ${lotNoGroup}, ${expDateGroup})
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
