-- Formal purchase-order snapshots for the Auth.js/Manager/Vendor workflow.
-- Additive and idempotent. Apply only after review on the target Neon branch.

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS reagent_type TEXT,
  ADD COLUMN IF NOT EXISTS job_type TEXT,
  ADD COLUMN IF NOT EXISTS machine_type TEXT;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS issuer_name TEXT,
  ADD COLUMN IF NOT EXISTS issuer_department TEXT,
  ADD COLUMN IF NOT EXISTS issuer_address TEXT,
  ADD COLUMN IF NOT EXISTS issuer_phone TEXT,
  ADD COLUMN IF NOT EXISTS issuer_email TEXT,
  ADD COLUMN IF NOT EXISTS issuer_logo_url TEXT;

CREATE TABLE IF NOT EXISTS lab_profile (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  organization_name TEXT NOT NULL DEFAULT 'LabStock',
  department_name TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO lab_profile (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_created_at
  ON purchase_orders (vendor, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id_id
  ON purchase_order_items (po_id, id);

CREATE INDEX IF NOT EXISTS idx_master_data_vendor_item_id
  ON master_data (vendor, item_id);

CREATE INDEX IF NOT EXISTS idx_inventory_item_quantity
  ON inventory (item_id, quantity);

CREATE INDEX IF NOT EXISTS idx_inventory_exp_date
  ON inventory (exp_date);

CREATE INDEX IF NOT EXISTS idx_shipments_tracking_no
  ON shipments (tracking_no);

CREATE INDEX IF NOT EXISTS idx_users_token
  ON users (token);
