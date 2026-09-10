import { describe, expect, it } from 'vitest';
import type { BarcodePattern, BarcodePatternV2Runtime } from './api-client';
import { findMatchingReagentWithV2 } from './barcode-parser';

const v1: BarcodePattern = {
  id: 1,
  name: 'V1 positional',
  regex_pattern: '^P-(ITEM-[0-9]+)-([A-Z0-9-]+)-([0-9]{8})$',
  item_id_group: 1,
  lot_no_group: 2,
  exp_date_group: 3,
};

const v2: BarcodePatternV2Runtime = {
  id: 2,
  name: 'V2 fixed',
  mapping_mode: 'FIXED_REAGENT',
  fixed_item_id: 'ITEM-001',
  regex_pattern: '^NEW-(LOT-[A-Z0-9-]+)-([0-9]{8})$',
  item_id_group: null,
  lot_no_group: 1,
  exp_date_group: 2,
};

describe('barcode learning V2 precedence', () => {
  it('keeps an existing V1 exact match ahead of V2', () => {
    const result = findMatchingReagentWithV2(
      'P-ITEM-001-LOT-1-20270101',
      [v1],
      [{ ...v2, regex_pattern: '^P-ITEM-001-.*$' }],
      [{ itemId: 'ITEM-001', qrCode: 'QR-001' }],
      true,
    );

    expect(result.match?.itemId).toBe('ITEM-001');
    expect(result.v2Match).toBeUndefined();
    expect(result.data?.barcodeType).toBe('CUSTOM_PATTERN');
  });

  it('allows V2 only when V1 cannot find a Master item', () => {
    const result = findMatchingReagentWithV2(
      'NEW-LOT-9-20270101',
      [v1],
      [v2],
      [{ itemId: 'ITEM-001', qrCode: 'QR-001' }],
      true,
    );

    expect(result.match?.itemId).toBe('ITEM-001');
    expect(result.v2Match?.patternId).toBe(2);
    expect(result.data?.lot).toBe('LOT-9');
  });

  it('keeps runtime flag off equivalent to no V2', () => {
    const result = findMatchingReagentWithV2(
      'NEW-LOT-9-20270101',
      [],
      [v2],
      [{ itemId: 'ITEM-001', qrCode: 'QR-001' }],
      false,
    );

    expect(result.match).toBeUndefined();
    expect(result.data?.barcodeType).toBe('STANDARD_1D');
  });

  it('never lets V2 reinterpret an unknown GS1 payload', () => {
    const result = findMatchingReagentWithV2(
      '(01)00012345678905(17)270101(10)LOT9',
      [],
      [{ ...v2, regex_pattern: '.*' }],
      [{ itemId: 'ITEM-001', qrCode: 'QR-001' }],
      true,
    );

    expect(result.data?.barcodeType).toBe('GS1_COMPLIANT');
    expect(result.match).toBeUndefined();
  });
});
