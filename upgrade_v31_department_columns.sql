-- v31: add department_id to every table that belongs to one department.
-- Part of the multi-department migration (v30 core -> v31 columns -> v32 constraints -> v33 item_code -> v34 indexes).
--
-- Design: the column is added with DEFAULT = the id of the default department (code 'CC', created by v30),
-- written as a literal. On PostgreSQL 11+ this is a "fast default": a metadata-only change, no table rewrite,
-- existing rows read as the default department immediately. Old application code that does not know about
-- department_id keeps working: its INSERTs omit the column and land in the default department.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to run more than once.
-- One DO block per table so each ACCESS EXCLUSIVE lock is held only for that table's (instant) ALTER.
-- All 18 tables below plus app_events were verified to exist in production (read-only schema check, 2026-10-08).
-- app_events gets a NULLABLE column with NO default (events may be system-wide / not tied to a department).
-- NOT run automatically. Apply with: node scripts/apply-migration.mjs upgrade_v31_department_columns.sql --confirm-host=<host>
SET lock_timeout = '3s';

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.master_data ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.vendor_item_aliases ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.shipment_batches ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.count_sessions ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.count_work_orders ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.reagent_loans ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.barcode_pattern_v2 ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.barcode_patterns ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.reagent_types ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.job_types ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.machine_types ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

DO $$
DECLARE v_dept integer := (SELECT id FROM public.departments WHERE code = 'CC');
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'default department (code CC) not found - run upgrade_v30_departments_core.sql first';
  END IF;
  EXECUTE format('ALTER TABLE public.lab_profile ADD COLUMN IF NOT EXISTS department_id integer DEFAULT %s', v_dept);
END $$;

-- app_events: nullable, no default (system events may belong to no department).
ALTER TABLE public.app_events ADD COLUMN IF NOT EXISTS department_id integer;

-- Verification: every department-owned row must resolve to a department. Raises (and the runner stops) otherwise.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['master_data','inventory','logs','vendors','vendor_item_aliases','purchase_orders','shipments','shipment_batches','count_sessions','count_work_orders','reagent_loans','barcode_pattern_v2','barcode_patterns','notification_outbox','reagent_types','job_types','machine_types','lab_profile'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE department_id IS NULL', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'v31 verification failed: % rows in % have NULL department_id', n, t;
    END IF;
  END LOOP;
END $$;
