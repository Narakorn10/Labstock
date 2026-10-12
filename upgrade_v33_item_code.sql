-- v33: master_data.item_code (per-department visible code) while item_id stays the global internal key.
-- Needs v31 first (not strictly, but v34 builds UNIQUE (department_id, item_code) on top of this).
-- Idempotent: safe to run more than once.
--
-- Order matters: the column and the BEFORE INSERT trigger come first, THEN the backfill, so a row inserted by the
-- running (old) app between steps still gets an item_code. Old INSERTs that omit item_code keep working:
-- the trigger copies NEW.item_id (already filled by the column default) into item_code.
-- NOT NULL uses the low-lock technique: validated CHECK -> SET NOT NULL (no scan) -> drop the helper CHECK.
-- The UNIQUE (department_id, item_code) index is NOT created here; that is v34.
-- NOT run automatically. Apply with: node scripts/apply-migration.mjs upgrade_v33_item_code.sql --confirm-host=<host>
SET lock_timeout = '3s';

ALTER TABLE public.master_data ADD COLUMN IF NOT EXISTS item_code text;

CREATE OR REPLACE FUNCTION public.master_data_set_item_code() RETURNS trigger AS $$
BEGIN
  IF NEW.item_code IS NULL OR btrim(NEW.item_code) = '' THEN
    NEW.item_code := NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_master_data_item_code
  BEFORE INSERT ON public.master_data
  FOR EACH ROW EXECUTE FUNCTION public.master_data_set_item_code();

UPDATE public.master_data SET item_code = item_id WHERE item_code IS NULL OR btrim(item_code) = '';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.master_data'::regclass AND attname = 'item_code' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.master_data'::regclass AND conname = 'master_data_item_code_nn') THEN
    ALTER TABLE public.master_data ADD CONSTRAINT master_data_item_code_nn CHECK (item_code IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.master_data'::regclass AND conname = 'master_data_item_code_nn') THEN
    ALTER TABLE public.master_data VALIDATE CONSTRAINT master_data_item_code_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.master_data'::regclass AND attname = 'item_code' AND NOT attnotnull) THEN
    ALTER TABLE public.master_data ALTER COLUMN item_code SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.master_data'::regclass AND conname = 'master_data_item_code_nn') THEN
    ALTER TABLE public.master_data DROP CONSTRAINT master_data_item_code_nn;
  END IF;
END $$;
