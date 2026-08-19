import { describe, expect, it } from 'vitest';
import {
  findBarcodeV2BehavioralConflicts,
  hasBarcodeV2AdvancedRegexInput,
} from './barcode-learning-v2-safety';

const example = (raw_barcode: string) => [{ raw_barcode }];

describe('barcode learning V2 safety helpers', () => {
  it('treats identical expressions as an active conflict', () => {
    const conflicts = findBarcodeV2BehavioralConflicts(
      { regex_pattern: '^A-(\\d+)$', examples: example('A-100') },
      [{ id: 7, name: 'Existing A', regex_pattern: '^A-(\\d+)$', examples: example('A-200') }],
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sameRegex).toBe(true);
  });

  it('detects overlap when the candidate sample matches an active pattern', () => {
    const conflicts = findBarcodeV2BehavioralConflicts(
      { regex_pattern: '^A-[0-9]+$', examples: example('A-100') },
      [{ id: 8, name: 'Broad A', regex_pattern: '^A-.*$', examples: example('B-100') }],
    );

    expect(conflicts[0]).toMatchObject({
      id: 8,
      candidateMatchesActivePattern: true,
    });
  });

  it('detects overlap in the reverse direction using active examples', () => {
    const conflicts = findBarcodeV2BehavioralConflicts(
      { regex_pattern: '^A-.*$', examples: example('B-100') },
      [{ id: 9, name: 'Specific A', regex_pattern: '^A-[0-9]+$', examples: example('A-100') }],
    );

    expect(conflicts[0]).toMatchObject({
      id: 9,
      activeMatchesCandidatePattern: true,
    });
  });

  it('does not flag evidence with no behavioral overlap', () => {
    const conflicts = findBarcodeV2BehavioralConflicts(
      { regex_pattern: '^A-[0-9]+$', examples: example('A-100') },
      [{ id: 10, name: 'B pattern', regex_pattern: '^B-[0-9]+$', examples: example('B-100') }],
    );

    expect(conflicts).toEqual([]);
  });

  it('recognizes advanced regex and capture-group input for API authorization', () => {
    expect(hasBarcodeV2AdvancedRegexInput({ regex_pattern: '^A-(.*)$' })).toBe(true);
    expect(hasBarcodeV2AdvancedRegexInput({ item_id_group: 1 })).toBe(true);
    expect(hasBarcodeV2AdvancedRegexInput({ regex_pattern: '', item_id_group: null })).toBe(false);
  });
});
