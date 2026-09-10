-- LabStock reagent lifecycle and automatic identifier upgrade.
-- Apply after upgrade_v17_reagent_order_suggestion_v5.sql.
-- Additive and idempotent: existing item_id values and transaction history remain intact.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS master_data_item_id_seq;

DO $$
DECLARE
  current_max BIGINT;
BEGIN
  SELECT COALESCE(MAX((substring(item_id FROM '^LAB-([0-9]+)$'))::BIGINT), 0)
    INTO current_max
  FROM master_data
  WHERE item_id ~ '^LAB-[0-9]+$';

  PERFORM setval(
    'master_data_item_id_seq',
    GREATEST(current_max, 1),
    current_max > 0
  );
END $$;

ALTER TABLE master_data
  ALTER COLUMN item_id SET DEFAULT (
    'LAB-' || LPAD(nextval('master_data_item_id_seq')::TEXT, 6, '0')
  ),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS status_reason TEXT,
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_changed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_master_data_is_active
  ON master_data (is_active, item_id);

CREATE TABLE IF NOT EXISTS master_data_status_history (
  id BIGSERIAL PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES master_data(item_id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL,
  reason TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_master_data_status_history_item_changed
  ON master_data_status_history (item_id, changed_at DESC);

ALTER TABLE reagent_order_policy
  ADD COLUMN IF NOT EXISTS review_days INTEGER NOT NULL DEFAULT 15
    CHECK (review_days BETWEEN 1 AND 365);

-- Stop stock movement at the database boundary. Existing stock remains queryable;
-- reactivation is required before a quantity can be inserted or changed again.
CREATE OR REPLACE FUNCTION labstock_require_active_master_data()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  active_state BOOLEAN;
BEGIN
  SELECT is_active INTO active_state
  FROM master_data
  WHERE item_id = NEW.item_id;

  IF COALESCE(active_state, FALSE) = FALSE THEN
    RAISE EXCEPTION 'REAGENT_INACTIVE:%', NEW.item_id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION labstock_assert(condition BOOLEAN, error_message TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(condition, FALSE) THEN
    RAISE EXCEPTION '%', error_message USING ERRCODE = '55000';
  END IF;
  RETURN TRUE;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_require_active_master_data ON inventory;
CREATE TRIGGER trg_inventory_require_active_master_data
  BEFORE INSERT OR UPDATE OF item_id, quantity ON inventory
  FOR EACH ROW
  EXECUTE FUNCTION labstock_require_active_master_data();

COMMIT;
