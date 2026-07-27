-- Support per-day receive rounds for the same lot

ALTER TABLE inventory
ADD COLUMN IF NOT EXISTS received_on DATE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inventory'
          AND column_name = 'created_at'
    ) THEN
        EXECUTE '
            UPDATE inventory
            SET received_on = COALESCE(received_on, created_at::date, CURRENT_DATE)
        ';
    ELSE
        EXECUTE '
            UPDATE inventory
            SET received_on = COALESCE(received_on, CURRENT_DATE)
        ';
    END IF;
END $$;

ALTER TABLE inventory
ALTER COLUMN received_on SET DEFAULT CURRENT_DATE;

UPDATE inventory
SET received_on = CURRENT_DATE
WHERE received_on IS NULL;

ALTER TABLE inventory
ALTER COLUMN received_on SET NOT NULL;

ALTER TABLE inventory
DROP CONSTRAINT IF EXISTS inventory_item_id_lot_no_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'inventory_item_id_lot_no_received_on_key'
          AND conrelid = 'inventory'::regclass
    ) THEN
        ALTER TABLE inventory
        ADD CONSTRAINT inventory_item_id_lot_no_received_on_key
        UNIQUE (item_id, lot_no, received_on);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_item_received_on
ON inventory (item_id, received_on DESC);
