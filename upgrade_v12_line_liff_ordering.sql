-- LINE LIFF ordering for Admin/Manager users.
-- Run once in Neon before relying on duplicate-submit protection from LINE.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS liff_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_liff_request_id_unique
  ON purchase_orders (liff_request_id)
  WHERE liff_request_id IS NOT NULL;

DROP INDEX IF EXISTS idx_purchase_orders_vendor_status;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_status
  ON purchase_orders (vendor, status, created_at DESC);
