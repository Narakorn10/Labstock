-- Vendor acknowledgement and line-level availability metadata for the reagent order workflow.
-- Run after upgrade_v14_reagent_order_recommendations.sql.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by TEXT,
  ADD COLUMN IF NOT EXISTS vendor_response_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision_reason TEXT;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS acknowledged_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS available_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS revision_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS revision_reason TEXT,
  ADD COLUMN IF NOT EXISTS accepted_qty NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_qty NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS accepted_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS rejected_qty NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_acknowledged_at
  ON purchase_orders (acknowledged_at);
