import sql from '@/lib/db';
import type { BarcodePattern, BarcodePatternV2Runtime, BarcodeRuntimeResponse } from '@/lib/api-client';

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
 * V2 is always on, but only ACTIVE patterns are served and V1 still wins first;
 * when V2 cannot be loaded it returns the exact legacy pattern list.
 */
export async function loadRuntimeBarcodePatterns(): Promise<BarcodeRuntimeResponse> {
  const patterns = await loadLegacyPatterns();
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
