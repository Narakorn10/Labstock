import sql from '@/lib/db';
import type {
  BarcodePatternV2,
  BarcodePatternV2Example,
  BarcodePatternV2Payload,
} from '@/lib/api-client';
import { loadLegacyPatternsForVerification } from '@/lib/barcode-runtime';
import { findMatchingReagent, normalizeLookupValue, processAnyBarcode, standardizeDate } from '@/lib/barcode-parser';
import {
  compilePortableRegex,
  findBarcodeV2BehavioralConflicts,
} from './barcode-learning-v2-safety';
export type {
  BarcodeV2BehavioralConflict,
  BarcodeV2PatternCollisionInput,
} from './barcode-learning-v2-safety';
import type { BarcodeV2PatternCollisionInput } from './barcode-learning-v2-safety';
export { findBarcodeV2BehavioralConflicts, hasBarcodeV2AdvancedRegexInput } from './barcode-learning-v2-safety';
import { deriveV2Regex } from './barcode-learning-v2-derive';
import type { BarcodeV2ValidationResult } from './barcode-learning-v2-derive';
export { deriveV2Regex } from './barcode-learning-v2-derive';
export type { BarcodeV2Verification, BarcodeV2ValidationResult } from './barcode-learning-v2-derive';

export interface BarcodeV2ValidationOptions {
  /** Exclude the pattern currently being rechecked, such as during Activate. */
  excludePatternId?: number;
}

const asText = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function normalizeV2Examples(rawExamples: unknown): BarcodePatternV2Example[] {
  const values = Array.isArray(rawExamples) ? rawExamples : [];
  return values.map((value) => {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
      raw_barcode: asText(item.raw_barcode),
      expected_item_id: asText(item.expected_item_id) || undefined,
      expected_lot: asText(item.expected_lot) || undefined,
      expected_exp_date: asText(item.expected_exp_date) || undefined,
    };
  });
}

export function normalizeV2Payload(body: unknown): BarcodePatternV2Payload {
  const input = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const examples = normalizeV2Examples(input.examples);

  const mappingMode = input.mapping_mode === 'FIXED_REAGENT' ? 'FIXED_REAGENT' : 'CAPTURED_IDENTIFIER';
  return {
    name: asText(input.name),
    mapping_mode: mappingMode,
    fixed_item_id: asText(input.fixed_item_id) || null,
    regex_pattern: asText(input.regex_pattern),
    item_id_group: toGroupIndex(input.item_id_group),
    lot_no_group: toGroupIndex(input.lot_no_group),
    exp_date_group: toGroupIndex(input.exp_date_group),
    examples,
  };
}

function toGroupIndex(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isPortableRegex(regex: string) {
  return !/(\(\?<|\\p\{|\\k<|\\\d|\(\?<=|\(\?<!|\(\?=|\(\?!)/.test(regex);
}

function valueMatches(expected: string | undefined, actual: string | undefined, date = false) {
  if (!expected) return true;
  const left = date ? standardizeDate(expected) : normalizeLookupValue(expected);
  const right = date ? standardizeDate(actual || '') : normalizeLookupValue(actual);
  return left === right;
}

async function loadMasterRows() {
  return sql`SELECT item_id, barcode FROM master_data`;
}

async function loadActiveV2PatternsForCollision(excludePatternId?: number) {
  const excludedId = Number.isSafeInteger(excludePatternId) ? excludePatternId as number : -1;
  return sql`
    SELECT id, name, regex_pattern, examples
    FROM barcode_pattern_v2
    WHERE status = 'ACTIVE' AND id <> ${excludedId}
  `;
}

function masterMatches(value: string, rows: Array<Record<string, unknown>>) {
  const key = normalizeLookupValue(value);
  return rows.some((row) => key && (
    normalizeLookupValue(String(row.item_id || '')) === key ||
    normalizeLookupValue(String(row.barcode || '')) === key
  ));
}

export async function validateBarcodeV2Payload(
  input: BarcodePatternV2Payload,
  options: BarcodeV2ValidationOptions = {},
): Promise<BarcodeV2ValidationResult> {
  const payload = { ...input, examples: input.examples.slice(0, 10) };
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!payload.name) errors.push('ต้องระบุชื่อรูปแบบ');
  if (payload.examples.length < 2) errors.push('ต้องมีตัวอย่างอย่างน้อย 2 รายการเพื่อเปิดใช้');
  if (payload.mapping_mode === 'FIXED_REAGENT' && !payload.fixed_item_id) errors.push('ต้องเลือก Master Data น้ำยา');
  if (!payload.examples.every((example) => example.raw_barcode)) errors.push('ทุกตัวอย่างต้องมี Raw Barcode');

  const derived = payload.regex_pattern ? {
    regex_pattern: payload.regex_pattern,
    item_id_group: payload.item_id_group,
    lot_no_group: payload.lot_no_group,
    exp_date_group: payload.exp_date_group,
    verification: { status: 'VERIFIED' as const, errors: [], warnings: [], checked_at: new Date().toISOString() },
  } : deriveV2Regex(payload);
  errors.push(...derived.verification.errors);
  const regexPattern = derived.regex_pattern;

  let regex: RegExp | null = null;
  if (regexPattern && !isPortableRegex(regexPattern)) {
    errors.push('Regex นี้ใช้ไวยากรณ์ที่ไม่ portable ระหว่าง Web และ Scanner Agent');
  } else if (regexPattern) {
    try {
      regex = new RegExp(regexPattern);
    } catch {
      errors.push('Regex ไม่ถูกต้อง');
    }
  }

  let masterRows: Array<Record<string, unknown>> = [];
  let legacyPatterns = [] as Awaited<ReturnType<typeof loadLegacyPatternsForVerification>>;
  let activePatterns: BarcodeV2PatternCollisionInput[] = [];
  try {
    const [loadedMasterRows, loadedLegacyPatterns, loadedActivePatterns] = await Promise.all([
      loadMasterRows() as unknown as Promise<Array<Record<string, unknown>>>,
      loadLegacyPatternsForVerification(),
      loadActiveV2PatternsForCollision(options.excludePatternId),
    ]);
    masterRows = loadedMasterRows;
    legacyPatterns = loadedLegacyPatterns;
    activePatterns = (loadedActivePatterns as Array<Record<string, unknown>>).map((pattern) => ({
      id: Number(pattern.id),
      name: String(pattern.name || ''),
      regex_pattern: String(pattern.regex_pattern || ''),
      examples: normalizeV2Examples(pattern.examples),
    }));
  } catch (error) {
    console.error('V2 verification data load failed:', error);
    errors.push('โหลด Master Data, รูปแบบ V1 หรือรูปแบบ V2 ที่เปิดใช้อยู่เพื่อตรวจสอบไม่สำเร็จ');
  }

  const legacyReagents = masterRows.map((row) => ({
    itemId: String(row.item_id || ''),
    qrCode: row.barcode ? String(row.barcode) : undefined,
  }));

  for (const [index, example] of payload.examples.entries()) {
    if (!regex || !example.raw_barcode) continue;
    const gs1 = processAnyBarcode(example.raw_barcode, [])?.barcodeType === 'GS1_COMPLIANT';
    if (gs1) errors.push(`ตัวอย่างที่ ${index + 1} เป็น GS1 ที่ระบบเดิมรองรับแล้ว`);

    const legacy = processAnyBarcode(example.raw_barcode, legacyPatterns);
    const legacyMatch = findMatchingReagent(example.raw_barcode, legacyPatterns, legacyReagents).match;
    if (legacy?.barcodeType === 'GS1_COMPLIANT' || legacyMatch || (legacy && masterMatches(legacy.gtin || legacy.rawString, masterRows))) {
      errors.push(`ตัวอย่างที่ ${index + 1} ชนกับการอ่านของระบบเดิม`);
    }

    const match = example.raw_barcode.match(regex);
    if (!match) {
      errors.push(`ตัวอย่างที่ ${index + 1} ไม่ตรงกับ Regex`);
      continue;
    }

    const itemValue = payload.mapping_mode === 'FIXED_REAGENT'
      ? payload.fixed_item_id || ''
      : (derived.item_id_group ? match[derived.item_id_group] || '' : '');
    if (!itemValue || !masterMatches(itemValue, masterRows)) {
      errors.push(`ตัวอย่างที่ ${index + 1} ไม่พบ Item ID ใน Master Data`);
    }
    if (!valueMatches(example.expected_item_id, itemValue)) errors.push(`ตัวอย่างที่ ${index + 1} Item ID ไม่ตรงค่าที่คาดหวัง`);
    if (!valueMatches(example.expected_lot, derived.lot_no_group ? match[derived.lot_no_group] : undefined)) errors.push(`ตัวอย่างที่ ${index + 1} Lot ไม่ตรงค่าที่คาดหวัง`);
    if (!valueMatches(example.expected_exp_date, derived.exp_date_group ? match[derived.exp_date_group] : undefined, true)) errors.push(`ตัวอย่างที่ ${index + 1} Expiry ไม่ตรงค่าที่คาดหวัง`);
  }

  if (payload.regex_pattern && payload.mapping_mode === 'CAPTURED_IDENTIFIER' && !derived.item_id_group) {
    errors.push('Captured Identifier ต้องระบุ Item ID capture group');
  }
  if (payload.mapping_mode === 'FIXED_REAGENT' && payload.fixed_item_id && !masterMatches(payload.fixed_item_id, masterRows)) {
    errors.push('ไม่พบ fixed reagent ใน Master Data');
  }

  if (regexPattern) {
    const invalidActivePattern = activePatterns.find((pattern) => !compilePortableRegex(pattern.regex_pattern));
    if (invalidActivePattern) {
      errors.push(`รูปแบบ V2 ที่เปิดใช้อยู่มี Regex ใช้งานไม่ได้: ${invalidActivePattern.name || invalidActivePattern.id}`);
    }
    const conflicts = findBarcodeV2BehavioralConflicts({
      regex_pattern: regexPattern,
      examples: payload.examples,
    }, activePatterns);
    for (const conflict of conflicts) {
      errors.push(`ชนกับรูปแบบ V2 ที่เปิดใช้อยู่แล้ว: ${conflict.name}`);
    }
  }

  const uniqueErrors = Array.from(new Set(errors));
  return {
    regex_pattern: regexPattern,
    item_id_group: derived.item_id_group ?? null,
    lot_no_group: derived.lot_no_group ?? null,
    exp_date_group: derived.exp_date_group ?? null,
    verification: {
      status: uniqueErrors.length ? 'UNVERIFIED' : 'VERIFIED',
      errors: uniqueErrors,
      warnings,
      checked_at: new Date().toISOString(),
    },
  };
}

/** Recreate a validation payload from persisted fields; do not trust old verification JSON. */
export function barcodeV2PayloadFromStoredRow(row: Record<string, unknown>): BarcodePatternV2Payload {
  return normalizeV2Payload({
    name: row.name,
    mapping_mode: row.mapping_mode,
    fixed_item_id: row.fixed_item_id,
    regex_pattern: row.regex_pattern,
    item_id_group: row.item_id_group,
    lot_no_group: row.lot_no_group,
    exp_date_group: row.exp_date_group,
    examples: row.examples,
  });
}

export function mapBarcodeV2Row(row: Record<string, unknown>): BarcodePatternV2 {
  const verification = (row.verification && typeof row.verification === 'object')
    ? row.verification as BarcodePatternV2['verification']
    : { status: 'UNVERIFIED' as const, errors: [] };
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    status: row.status as BarcodePatternV2['status'],
    mapping_mode: row.mapping_mode as BarcodePatternV2['mapping_mode'],
    fixed_item_id: row.fixed_item_id ? String(row.fixed_item_id) : null,
    regex_pattern: String(row.regex_pattern || ''),
    item_id_group: row.item_id_group === null ? null : Number(row.item_id_group),
    lot_no_group: row.lot_no_group === null ? null : Number(row.lot_no_group),
    exp_date_group: row.exp_date_group === null ? null : Number(row.exp_date_group),
    examples: Array.isArray(row.examples) ? row.examples as BarcodePatternV2Example[] : [],
    verification,
    created_by: row.created_by ? String(row.created_by) : undefined,
    updated_by: row.updated_by ? String(row.updated_by) : undefined,
    activated_by: row.activated_by ? String(row.activated_by) : null,
    deactivation_reason: row.deactivation_reason ? String(row.deactivation_reason) : null,
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
    activated_at: row.activated_at ? new Date(String(row.activated_at)).toISOString() : null,
    deactivated_at: row.deactivated_at ? new Date(String(row.deactivated_at)).toISOString() : null,
  };
}
