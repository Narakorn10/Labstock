-- ROLLBACK of v32: removes the department_id foreign keys and NOT NULL constraints (columns stay; v31 rollback drops them).
-- Idempotent. Safe at any time: it only loosens constraints.
SET lock_timeout = '3s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['master_data','inventory','logs','vendors','vendor_item_aliases','purchase_orders','shipments','shipment_batches','count_sessions','count_work_orders','reagent_loans','barcode_pattern_v2','barcode_patterns','notification_outbox','reagent_types','job_types','machine_types','lab_profile','app_events'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t) AND attname = 'department_id' AND NOT attisdropped) THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_department_id_fkey');
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_department_id_nn');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN department_id DROP NOT NULL', t);
  END LOOP;
END $$;
