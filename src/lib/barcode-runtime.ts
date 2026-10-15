import sql from '@/lib/db';
import { andDept, type DepartmentScope } from '@/lib/scoped-db';
import type { BarcodePattern, BarcodePatternV2Runtime, BarcodeRuntimeResponse } from '@/lib/api-client';

// Every loader takes a REQUIRED scope. The runtime check guards the slot against a wrong argument (a user object, a
// string, undefined...) landing there: andDept() treats any non-"one" mode as "no filter", which would fail open.
function assertScope(scope: DepartmentScope | undefined): asserts scope is DepartmentScope {
  const mode = (scope as { mode?: unknown } | undefined)?.mode;
  if (mode !== 'legacy' && mode !== 'one' && mode !== 'all') {
    throw new Error('Barcode runtime loaders require a DepartmentScope');
  }
}

async function loadLegacyPatterns(scope: DepartmentScope): Promise<BarcodePattern[]> {
  assertScope(scope);
  const rows = await sql`
    SELECT id, name, regex_pattern, item_id_group, lot_no_group, exp_date_group
    FROM barcode_patterns
    WHERE TRUE${andDept(scope)}
    ORDER BY created_at DESC
  `;
  return rows as unknown as BarcodePattern[];
}

async function loadActiveV2Patterns(scope: DepartmentScope): Promise<BarcodePatternV2Runtime[]> {
  assertScope(scope);
  const rows = await sql`
    SELECT id, name, mapping_mode, fixed_item_id,
           regex_pattern, item_id_group, lot_no_group, exp_date_group
    FROM barcode_pattern_v2
    WHERE status = 'ACTIVE'${andDept(scope)}
    ORDER BY created_at DESC, id DESC
  `;
  return rows as unknown as BarcodePatternV2Runtime[];
}

/**
 * The single runtime loader used by web, mobile and station catalog endpoints.
 * V2 is always on, but only ACTIVE patterns are served and V1 still wins first;
 * when V2 cannot be loaded it returns the exact legacy pattern list.
 */
export async function loadRuntimeBarcodePatterns(scope: DepartmentScope): Promise<BarcodeRuntimeResponse> {
  assertScope(scope); // outside the V2 try/catch below so a bad scope is never swallowed as "V2 unavailable"
  const patterns = await loadLegacyPatterns(scope);
  try {
    const v2Patterns = await loadActiveV2Patterns(scope);
    return { patterns, v2Patterns, engineVersion: v2Patterns.length > 0 ? 2 : 1, v2Available: true };
  } catch (error) {
    // Fail closed: keep the proven V1 runtime and make the V2 absence observable.
    console.error('Barcode Learning V2 runtime unavailable; retaining V1 only:', error);
    return { patterns, v2Patterns: [], engineVersion: 1, v2Available: false };
  }
}

export async function loadLegacyPatternsForVerification(scope: DepartmentScope) {
  return loadLegacyPatterns(scope);
}
