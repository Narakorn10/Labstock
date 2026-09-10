-- Collaborative purchase-order workflow: Lab-originated orders and Vendor proposals.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS proposal_origin TEXT NOT NULL DEFAULT 'LAB',
  ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

UPDATE purchase_orders
SET proposal_origin = 'LAB'
WHERE proposal_origin IS NULL OR proposal_origin = '';

CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_status
  ON purchase_orders (vendor, status, created_at DESC);
