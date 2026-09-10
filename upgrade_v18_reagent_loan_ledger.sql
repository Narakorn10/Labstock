-- Reagent loan ledger: records items borrowed from and lent to other units.
-- Apply through the approved Production migration workflow; this file is idempotent.
CREATE TABLE IF NOT EXISTS reagent_loans (
  id BIGSERIAL PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('BORROWED_IN', 'LENT_OUT')),
  partner_name TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES master_data(item_id),
  item_name TEXT NOT NULL,
  lot_no TEXT NOT NULL,
  exp_date DATE NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  returned_qty NUMERIC NOT NULL DEFAULT 0 CHECK (returned_qty >= 0 AND returned_qty <= quantity),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  loaned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  returned_at TIMESTAMPTZ NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reagent_loans_open_direction_idx
  ON reagent_loans (direction, status, loaned_at DESC);
CREATE INDEX IF NOT EXISTS reagent_loans_partner_idx
  ON reagent_loans (partner_name, status);
