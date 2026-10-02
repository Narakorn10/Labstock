import type { BarcodePatternV2Payload } from './api-client';

export interface BarcodeV2Verification {
  status: 'VERIFIED' | 'UNVERIFIED';
  errors: string[];
  warnings: string[];
  checked_at: string;
}

export interface BarcodeV2ValidationResult {
  verification: BarcodeV2Verification;
  regex_pattern: string;
  item_id_group: number | null;
  lot_no_group: number | null;
  exp_date_group: number | null;
}

function findOccurrence(raw: string, value: string) {
  if (!value) return -1;
  return raw.indexOf(value);
}

/** Build a portable positional regex from the first sample's expected values. */
export function deriveV2Regex(payload: BarcodePatternV2Payload): BarcodeV2ValidationResult {
  const errors: string[] = [];
  const first = payload.examples[0];
  if (!first?.raw_barcode) {
    return {
      verification: { status: 'UNVERIFIED', errors: ['ต้องมีตัวอย่างอย่างน้อย 1 รายการ'], warnings: [], checked_at: new Date().toISOString() },
      regex_pattern: '', item_id_group: null, lot_no_group: null, exp_date_group: null,
    };
  }

  const fields: Array<{ type: 'item' | 'lot' | 'exp'; value: string }> = [];
  if (payload.mapping_mode === 'CAPTURED_IDENTIFIER') {
    if (!first.expected_item_id) errors.push('ตัวอย่างที่ 1 ต้องระบุ Item ID');
    else fields.push({ type: 'item', value: first.expected_item_id });
  }
  if (first.expected_lot) fields.push({ type: 'lot', value: first.expected_lot });
  if (first.expected_exp_date) fields.push({ type: 'exp', value: first.expected_exp_date });

  if (payload.mapping_mode === 'FIXED_REAGENT' && !payload.fixed_item_id) {
    errors.push('ต้องเลือกน้ำยา Master Data สำหรับการผูกแบบรายการเดียว');
  }
  if (fields.length === 0 && payload.mapping_mode === 'CAPTURED_IDENTIFIER') {
    errors.push('ต้องระบุค่าที่คาดหวังอย่างน้อย Item ID');
  }

  const positioned = fields.map((field) => ({ ...field, start: findOccurrence(first.raw_barcode, field.value) }));
  if (positioned.some((field) => field.start < 0)) {
    errors.push('ค่าที่คาดหวังบางรายการไม่พบใน Barcode ตัวอย่างที่ 1');
  }
  positioned.sort((left, right) => left.start - right.start);
  for (let index = 1; index < positioned.length; index += 1) {
    const previous = positioned[index - 1];
    if (positioned[index].start < previous.start + previous.value.length) {
      errors.push('ช่วง Item/Lot/Expiry ในตัวอย่างซ้อนทับกัน');
    }
  }

  let regex = '^';
  let cursor = 0;
  let group = 1;
  let itemIdGroup: number | null = null;
  let lotNoGroup: number | null = null;
  let expDateGroup: number | null = null;
  for (const field of positioned) {
    if (field.start < 0) continue;
    regex += `[\\s\\S]{${field.start - cursor}}([\\s\\S]{${field.value.length}})`;
    if (field.type === 'item') itemIdGroup = group;
    if (field.type === 'lot') lotNoGroup = group;
    if (field.type === 'exp') expDateGroup = group;
    cursor = field.start + field.value.length;
    group += 1;
  }
  regex += '[\\s\\S]*$';

  return {
    verification: { status: errors.length ? 'UNVERIFIED' : 'VERIFIED', errors, warnings: [], checked_at: new Date().toISOString() },
    regex_pattern: errors.length ? '' : regex,
    item_id_group: itemIdGroup,
    lot_no_group: lotNoGroup,
    exp_date_group: expDateGroup,
  };
}

/**
 * Read a second sample with the positions learned from the first one, so the
 * wizard can pre-fill its expected values. Returns null when it cannot be read.
 */
export function previewV2Values(payload: BarcodePatternV2Payload, raw: string) {
  const derived = deriveV2Regex(payload);
  if (!derived.regex_pattern || !raw) return null;
  const match = raw.match(new RegExp(derived.regex_pattern));
  if (!match) return null;
  return {
    item: derived.item_id_group ? match[derived.item_id_group] : undefined,
    lot: derived.lot_no_group ? match[derived.lot_no_group] : undefined,
    exp: derived.exp_date_group ? match[derived.exp_date_group] : undefined,
  };
}
