-- ROLLBACK of v36: drops the unique constraint lab_profile_department_id_key (only the one v36 adds, by that exact name)
-- and puts the single-row CHECK (id = 1) back. No data row is changed or deleted.
-- Refuses (error, nothing changed) if lab_profile has any row with id <> 1, because the CHECK could not be restored.
-- In that case a person must decide what to do with the extra letterhead rows; this file never deletes them.
-- Run this FIRST (before the v35 ... v31 rollbacks). Idempotent, and also fine if the v31 rollback already dropped department_id.
-- The CHECK is re-added as lab_profile_id_check; the original name on Neon may differ, which is harmless.
-- NOT run automatically — do not run until the owner approves.
SET lock_timeout = '3s';

DO $v36$
BEGIN
  IF to_regclass('public.lab_profile') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.lab_profile WHERE id <> 1) THEN
    RAISE EXCEPTION 'rollback refused: lab_profile has rows with id <> 1; nothing was changed and no row was deleted';
  END IF;

  ALTER TABLE public.lab_profile DROP CONSTRAINT IF EXISTS lab_profile_department_id_key;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lab_profile'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ '^CHECK \(+id = 1\)+$'
  ) THEN
    ALTER TABLE public.lab_profile ADD CONSTRAINT lab_profile_id_check CHECK (id = 1);
  END IF;
END
$v36$;
