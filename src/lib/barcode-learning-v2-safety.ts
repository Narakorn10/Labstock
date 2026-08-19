import type { BarcodePatternV2Example } from './api-client';

export interface BarcodeV2PatternCollisionInput {
  id?: number;
  name?: string;
  regex_pattern: string;
  examples: BarcodePatternV2Example[];
}

export interface BarcodeV2BehavioralConflict {
  id: number;
  name: string;
  sameRegex: boolean;
  candidateMatchesActivePattern: boolean;
  activeMatchesCandidatePattern: boolean;
}

const asText = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** Treat any supplied regex or capture-group mapping as the Admin-only path. */
export function hasBarcodeV2AdvancedRegexInput(body: unknown) {
  const input = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const hasGroup = (value: unknown) => value !== null
    && value !== undefined
    && !(typeof value === 'string' && value.trim() === '');
  return asText(input.regex_pattern).length > 0
    || hasGroup(input.item_id_group)
    || hasGroup(input.lot_no_group)
    || hasGroup(input.exp_date_group);
}

function isPortableRegex(regex: string) {
  return !/(\(\?<|\\p\{|\\k<|\\\d|\(\?<=|\(\?<!|\(\?=|\(\?!)/.test(regex);
}

export function compilePortableRegex(regexPattern: string) {
  if (!regexPattern || !isPortableRegex(regexPattern)) return null;
  try {
    return new RegExp(regexPattern);
  } catch {
    return null;
  }
}

function rawExampleValues(examples: BarcodePatternV2Example[]) {
  return examples.map((example) => example.raw_barcode).filter(Boolean);
}

/**
 * Compare both directions against submitted evidence because different regex
 * strings can still accept the same barcode.
 */
export function findBarcodeV2BehavioralConflicts(
  candidate: BarcodeV2PatternCollisionInput,
  activePatterns: BarcodeV2PatternCollisionInput[],
): BarcodeV2BehavioralConflict[] {
  const candidateRegex = compilePortableRegex(candidate.regex_pattern);
  if (!candidateRegex) return [];

  const candidateSamples = rawExampleValues(candidate.examples);
  return activePatterns.flatMap((active) => {
    const activeRegex = compilePortableRegex(active.regex_pattern);
    if (!activeRegex || !active.id) return [];

    const activeSamples = rawExampleValues(active.examples);
    const sameRegex = candidate.regex_pattern === active.regex_pattern;
    const candidateMatchesActivePattern = candidateSamples.some((sample) => activeRegex.test(sample));
    const activeMatchesCandidatePattern = activeSamples.some((sample) => candidateRegex.test(sample));
    if (!sameRegex && !candidateMatchesActivePattern && !activeMatchesCandidatePattern) return [];

    return [{
      id: active.id,
      name: active.name || String(active.id),
      sameRegex,
      candidateMatchesActivePattern,
      activeMatchesCandidatePattern,
    }];
  });
}
