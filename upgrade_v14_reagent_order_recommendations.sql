-- Reagent order recommendation policy and audit metadata.
-- Run this after upgrade_v10_purchase_order_collaboration.sql in production.

CREATE TABLE IF NOT EXISTS reagent_order_policy (
    item_id TEXT PRIMARY KEY REFERENCES master_data(item_id) ON DELETE CASCADE,
    tests_per_box NUMERIC CHECK (tests_per_box IS NULL OR tests_per_box > 0),
    avg_patient_tests_per_month NUMERIC NOT NULL DEFAULT 0 CHECK (avg_patient_tests_per_month >= 0),
    iqc_tests_per_month NUMERIC NOT NULL DEFAULT 0 CHECK (iqc_tests_per_month >= 0),
    approved_monthly_target_boxes NUMERIC CHECK (approved_monthly_target_boxes IS NULL OR approved_monthly_target_boxes >= 0),
    orders_per_month NUMERIC NOT NULL DEFAULT 1 CHECK (orders_per_month > 0),
    lead_time_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_time_days >= 0),
    safety_stock_boxes NUMERIC CHECK (safety_stock_boxes IS NULL OR safety_stock_boxes >= 0),
    min_order_qty_boxes INTEGER NOT NULL DEFAULT 1 CHECK (min_order_qty_boxes > 0),
    order_multiple_boxes INTEGER NOT NULL DEFAULT 1 CHECK (order_multiple_boxes > 0),
    enabled BOOLEAN NOT NULL DEFAULT true,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_reagent_order_policy_enabled
ON reagent_order_policy(enabled);

ALTER TABLE purchase_order_items
    ADD COLUMN IF NOT EXISTS system_suggested_qty NUMERIC,
    ADD COLUMN IF NOT EXISTS override_reason TEXT,
    ADD COLUMN IF NOT EXISTS calculation_version TEXT,
    ADD COLUMN IF NOT EXISTS calculation_snapshot JSONB;

INSERT INTO reagent_order_policy (
    item_id,
    approved_monthly_target_boxes,
    safety_stock_boxes,
    reason
)
SELECT
    item_id,
    NULLIF(COALESCE(weekly_target, 0) * 4, 0),
    NULLIF(COALESCE(min_threshold, 0), 0),
    'Seeded from master_data weekly_target and min_threshold; review against manual sheet before approval.'
FROM master_data
ON CONFLICT (item_id) DO NOTHING;
