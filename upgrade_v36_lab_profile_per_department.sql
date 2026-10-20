-- v36: letterhead (lab_profile) per department. Today lab_profile can hold only ONE row (CHECK id = 1).
-- This file removes that CHECK and makes department_id unique, so a later PR can keep one letterhead row per department.
-- Additive only: NO data row is inserted, updated or deleted here. Row id = 1 (the CC letterhead) stays exactly as it is.
-- id stays the primary key with DEFAULT 1, and the app still reads id = 1. Nothing in the app changes by running this file.
-- Requires v31 (lab_profile.department_id) and v32 (department_id NOT NULL) first. If they are missing the file stops with an error.
-- The real name of the CHECK on Neon is NOT known. This file finds it by its definition (CHECK on column id only, "id = 1"),
-- not by name. RAISE NOTICE is not shown by the runner, so BEFORE running, record the real constraint name read-only
-- (see docs/departments-rollout.md section 10).
-- Idempotent: running again changes nothing. If a valid unique index on exactly (department_id) already exists under another
-- name, no second one is added (and the rollback will not drop it).
-- Rolling back: run upgrade_v36_lab_profile_per_department_rollback.sql FIRST, then v35 ... v32, v31 (newest first).
-- NOT run automatically — do not run until the owner approves.
-- Apply with: node scripts/apply-migration.mjs upgrade_v36_lab_profile_per_department.sql --confirm-host=<non-pooler host>
SET lock_timeout = '3s';

DO $v36$
DECLARE
  v_dept integer;
  v_id_attnum smallint;
  v_dept_attnum smallint;
  v_rows_before bigint;
  v_rows_after bigint;
  v_con record;
  v_unique_count integer;
BEGIN
  -- Pre-checks: nothing has been changed yet if any of these raise.
  IF to_regclass('public.lab_profile') IS NULL THEN
    RAISE EXCEPTION 'v36 stopped: table public.lab_profile does not exist';
  END IF;

  SELECT attnum INTO v_id_attnum FROM pg_attribute
    WHERE attrelid = 'public.lab_profile'::regclass AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO v_dept_attnum FROM pg_attribute
    WHERE attrelid = 'public.lab_profile'::regclass AND attname = 'department_id' AND attnotnull AND NOT attisdropped;
  IF v_id_attnum IS NULL THEN
    RAISE EXCEPTION 'v36 stopped: lab_profile.id column not found';
  END IF;
  IF v_dept_attnum IS NULL THEN
    RAISE EXCEPTION 'v36 stopped: lab_profile.department_id is missing or still nullable - run v31/v32 first';
  END IF;

  IF to_regclass('public.departments') IS NULL THEN
    RAISE EXCEPTION 'v36 stopped: table public.departments does not exist - run v30/v31/v32 first';
  END IF;
  SELECT id INTO v_dept FROM public.departments WHERE code = 'CC';
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'v36 stopped: department with code CC not found - run v30 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lab_profile WHERE id = 1 AND department_id = v_dept) THEN
    RAISE EXCEPTION 'v36 stopped: lab_profile row id = 1 must exist and belong to department CC';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lab_profile GROUP BY department_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'v36 stopped: lab_profile already has duplicate department_id rows';
  END IF;

  SELECT count(*) INTO v_rows_before FROM public.lab_profile;

  -- Drop the single-row CHECK (found by definition, not by name). Any other CHECK that only touches column id is unexpected: stop.
  FOR v_con IN
    SELECT oid, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.lab_profile'::regclass AND contype = 'c' AND conkey = ARRAY[v_id_attnum]::int2[]
  LOOP
    IF v_con.def ~ '^CHECK \(+id = 1\)+$' THEN
      EXECUTE format('ALTER TABLE public.lab_profile DROP CONSTRAINT %I', v_con.conname);
    ELSE
      RAISE EXCEPTION 'v36 stopped: unexpected CHECK % on lab_profile.id: %', v_con.conname, v_con.def;
    END IF;
  END LOOP;

  -- One letterhead per department: add a unique constraint unless a valid full unique index on exactly (department_id) exists.
  SELECT count(*) INTO v_unique_count FROM pg_index
    WHERE indrelid = 'public.lab_profile'::regclass
      AND indisunique AND indisvalid AND indnatts = 1 AND indkey[0] = v_dept_attnum
      AND indpred IS NULL AND indexprs IS NULL;
  IF v_unique_count = 0 THEN
    ALTER TABLE public.lab_profile ADD CONSTRAINT lab_profile_department_id_key UNIQUE (department_id);
  END IF;

  -- Post-checks: any failure raises, and the whole block (a single statement) is undone.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lab_profile'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ '^CHECK \(+id = 1\)+$'
  ) THEN
    RAISE EXCEPTION 'v36 failed: the id = 1 CHECK is still present';
  END IF;
  SELECT count(*) INTO v_unique_count FROM pg_index
    WHERE indrelid = 'public.lab_profile'::regclass
      AND indisunique AND indisvalid AND indnatts = 1 AND indkey[0] = v_dept_attnum
      AND indpred IS NULL AND indexprs IS NULL;
  IF v_unique_count <> 1 THEN
    RAISE EXCEPTION 'v36 failed: expected exactly one unique index on lab_profile(department_id), found %', v_unique_count;
  END IF;
  SELECT count(*) INTO v_rows_after FROM public.lab_profile;
  IF v_rows_after <> v_rows_before THEN
    RAISE EXCEPTION 'v36 failed: lab_profile row count changed (% -> %)', v_rows_before, v_rows_after;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lab_profile WHERE id = 1 AND department_id = v_dept) THEN
    RAISE EXCEPTION 'v36 failed: lab_profile row id = 1 no longer belongs to department CC';
  END IF;
END
$v36$;
