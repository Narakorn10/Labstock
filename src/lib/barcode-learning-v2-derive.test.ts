import { describe, expect, it } from 'vitest';
import { previewV2Values } from './barcode-learning-v2-derive';

const firstSample = {
  name: 'Vendor QR',
  mapping_mode: 'CAPTURED_IDENTIFIER' as const,
  fixed_item_id: null,
  examples: [{ raw_barcode: 'HDR|GLU-001|LOT24001|20271231|END', expected_item_id: 'GLU-001', expected_lot: 'LOT24001', expected_exp_date: '20271231' }],
};

describe('previewV2Values', () => {
  it('reads a second sample at the positions learned from the first', () => {
    expect(previewV2Values(firstSample, 'HDR|GLU-001|LOT25077|20280615|END')).toEqual({ item: 'GLU-001', lot: 'LOT25077', exp: '20280615' });
  });

  it('returns null when the second sample is too short to hold the learned positions', () => {
    expect(previewV2Values(firstSample, 'HDR|GLU-001')).toBeNull();
  });

  it('returns null until the first sample has the values it needs', () => {
    const missingItem = { ...firstSample, examples: [{ ...firstSample.examples[0], expected_item_id: '' }] };
    expect(previewV2Values(missingItem, 'HDR|GLU-001|LOT25077|20280615|END')).toBeNull();
  });
});
