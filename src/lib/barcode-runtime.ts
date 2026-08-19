import sql from '@/lib/db';
import type { BarcodePattern, BarcodePatternV2Runtime, BarcodeRuntimeResponse } from '@/lib/api-client';

export function isBarcodeLearningV2ManagementEnabled() {
  return process.env.BARCODE_LEARNING_V2_MANAGEMENT_ENABLED === 'true';
}

export function isBarcodeLearningV2RuntimeEnabled() {
  return process.env.BARCODE_LEARNING_V2_RUNTIME_ENABLED === 'true';
}

async function loadLegacyPatterns(): Promise<BarcodePattern[]> {
  const rows = await sql`
    SELECT id, name, regex_pattern, item_id_group, lot_no_group, exp_date_group
    FROM barcode_patterns
    ORDER BY created_at DESC
  `;
  return rows as unknown as BarcodePattern[];
}

async function loadActiveV2Patterns(): Promise<BarcodePatternV2Runtime[]> {
  const rows = await sql`
    SELECT id, name, mapping_mode, fixed_item_id,
           regex_pattern, item_id_group, lot_no_group, exp_date_group
    FROM barcode_pattern_v2
    WHERE status = 'ACTIVE'
    ORDER BY created_at DESC, id DESC
  `;
  return rows as unknown as BarcodePatternV2Runtime[];
}

/**
 * The single runtime loader used by web, mobile and station catalog endpoints.
 * When V2 is unavailable or disabled it returns the exact legacy pattern list.
 */
export async function loadRuntimeBarcodePatterns(): Promise<BarcodeRuntimeResponse> {
  const patterns = await loadLegacyPatterns();
  if (!isBarcodeLearningV2RuntimeEnabled()) {
    return { patterns, v2Patterns: [], engineVersion: 1, v2Available: false };
  }

  try {
    const v2Patterns = await loadActiveV2Patterns();
    return { patterns, v2Patterns, engineVersion: v2Patterns.length > 0 ? 2 : 1, v2Available: true };
  } catch (error) {
    // Fail closed: keep the proven V1 runtime and make the V2 absence observable.
    console.error('Barcode Learning V2 runtime unavailable; retaining V1 only:', error);
    return { patterns, v2Patterns: [], engineVersion: 1, v2Available: false };
  }
}

export async function loadLegacyPatternsForVerification() {
  return loadLegacyPatterns();
}
