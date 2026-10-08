-- ROLLBACK of v30: drops user_departments and the departments.code / is_active columns.
-- Run the v31-v34 rollbacks first (their columns and constraints reference departments).
-- WARNING: UNSAFE once a second department exists or users have non-default memberships; this script refuses then.
-- No departments row is ever deleted (the default 'ห้องปฏิบัติการเคมีคลินิก' is a real, pre-existing department).
-- The code 'CC' set by v30 is reset to NULL before the column is dropped.
-- Re-running v30 afterwards finds that row by name and sets its code again.
-- Idempotent.
SET lock_timeout = '3s';

-- Dynamic SQL so the guard still parses when a previous run already dropped departments.code / user_departments.
DO $$
DECLARE
  found boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'code') THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM departments WHERE code IS NOT NULL AND code <> ''CC'')' INTO found;
    IF found THEN
      RAISE EXCEPTION 'rollback refused: departments other than the default exist';
    END IF;
    IF to_regclass('public.user_departments') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM user_departments ud JOIN departments d ON d.id = ud.department_id WHERE d.code IS DISTINCT FROM ''CC'')' INTO found;
      IF found THEN
        RAISE EXCEPTION 'rollback refused: users belong to a non-default department';
      END IF;
    END IF;
    EXECUTE 'UPDATE departments SET code = NULL WHERE code = ''CC''';
  END IF;
END $$;

DROP TABLE IF EXISTS user_departments;
DROP INDEX IF EXISTS departments_code_key;
ALTER TABLE departments DROP COLUMN IF EXISTS code;
ALTER TABLE departments DROP COLUMN IF EXISTS is_active;
