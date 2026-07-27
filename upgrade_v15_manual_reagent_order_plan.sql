-- Manual AU5800/DxI800 reagent plan: two purchase cycles per month.
-- Values transcribed from the approved worksheet. The per-cycle quantity is
-- kept separately so replenishment remains stable when live stock fluctuates.

ALTER TABLE reagent_order_policy
    ADD COLUMN IF NOT EXISTS approved_order_qty_boxes NUMERIC
        CHECK (approved_order_qty_boxes IS NULL OR approved_order_qty_boxes >= 0);

WITH manual_plan (item_id, monthly_boxes, order_boxes) AS (
    VALUES
        ('CHEM-R-001', 15, 8), ('CHEM-R-002', 25, 13), ('CHEM-R-003', 68, 35),
        ('CHEM-R-004', 4, 2), ('CHEM-R-005', 10, 5), ('CHEM-R-006', 10, 5),
        ('CHEM-R-007', 18, 9), ('CHEM-R-008', 3, 2), ('CHEM-R-009', 10, 5),
        ('CHEM-R-010', 10, 5), ('CHEM-R-011', 12, 6), ('CHEM-R-012', 12, 6),
        ('CHEM-R-013', 15, 8), ('CHEM-R-014', 12, 6), ('CHEM-R-015', 30, 15),
        ('CHEM-R-016', 25, 15), ('CHEM-R-017', 6, 3), ('CHEM-R-018', 8, 4),
        ('CHEM-R-019', 15, 7), ('CHEM-R-020', 2, 1), ('CHEM-R-021', 2, 1),
        ('CHEM-R-022', 2, 1), ('CHEM-R-023', 5, 3), ('CHEM-R-024', 1, 1),
        ('CHEM-R-025', 1, 1), ('CHEM-R-026', 6, 3), ('CHEM-R-027', 24, 12),
        ('CHEM-R-028', 10, 5), ('CHEM-R-029', 1, 1), ('CHEM-R-030', 1, 1),
        ('CHEM-R-031', 2, 1), ('CHEM-R-032', 1, 1), ('CHEM-R-033', 1, 1),
        ('IM-R-001', 15, 8), ('IM-R-002', 18, 9), ('IM-R-003', 10, 5),
        ('IM-R-004', 0, 0), ('IM-R-005', 0, 0), ('IM-R-006', 6, 3),
        ('IM-R-007', 1, 1), ('IM-R-008', 2, 1), ('IM-R-009', 6, 3),
        ('IM-R-010', 1, 1), ('IM-R-011', 3, 2), ('IM-R-012', 1, 1),
        ('IM-R-013', 1, 1), ('IM-R-014', 5, 3), ('IM-R-015', 1, 1),
        ('IM-R-016', 1, 1), ('IM-R-017', 1, 1), ('IM-R-018', 12, 6)
)
UPDATE reagent_order_policy policy
SET approved_monthly_target_boxes = manual_plan.monthly_boxes,
    approved_order_qty_boxes = manual_plan.order_boxes,
    orders_per_month = 2,
    reason = 'AU5800/DxI800 manual plan, reviewed 2026-07-27: two orders per month.',
    updated_at = NOW()
FROM manual_plan
WHERE policy.item_id = manual_plan.item_id;
