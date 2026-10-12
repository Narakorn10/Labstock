-- ROLLBACK of v31: drops department_id from every table v31 touched.
-- Run the v34/v33/v32 rollbacks first (indexes and constraints that reference the column).
-- WARNING: UNSAFE once a second department has data. Dropping the column would merge all departments into one and
-- lose the information about which department owned each row. This script refuses to run in that case.
-- Idempotent. Safe only while every row still belongs to the default department (code 'CC').
SET lock_timeout = '3s';

DO $$
DECLARE
  t text;
  v_dept integer;
  n bigint;
BEGIN
  -- Dynamic SQL: still parses if a previous run of the v30 rollback already dropped departments.code.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'code') THEN
    EXECUTE 'SELECT id FROM public.departments WHERE code = ''CC''' INTO v_dept;
  END IF;
  FOREACH t IN ARRAY ARRAY['master_data','inventory','logs','vendors','vendor_item_aliases','purchase_orders','shipments','shipment_batches','count_sessions','count_work_orders','reagent_loans','barcode_pattern_v2','barcode_patterns','notification_outbox','reagent_types','job_types','machine_types','lab_profile','app_events'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t) AND attname = 'department_id' AND NOT attisdropped) THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE department_id IS NOT NULL AND department_id IS DISTINCT FROM %L::integer', t, v_dept) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'rollback refused: % rows in % belong to a department other than the default', n, t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['master_data','inventory','logs','vendors','vendor_item_aliases','purchase_orders','shipments','shipment_batches','count_sessions','count_work_orders','reagent_loans','barcode_pattern_v2','barcode_patterns','notification_outbox','reagent_types','job_types','machine_types','lab_profile','app_events'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS department_id', t);
  END LOOP;
END $$;
