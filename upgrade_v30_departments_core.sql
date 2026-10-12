-- v30: departments core + user_departments (multi-department foundation).
-- Part of the multi-department migration (v30 core -> v31 columns -> v32 constraints -> v33 item_code -> v34 indexes).
-- Additive and idempotent: safe to run more than once. Nothing is renamed or deleted.
--
-- Assumptions (report these to the owner):
--   * The default department (owner of all existing data) is the EXISTING 'ห้องปฏิบัติการเคมีคลินิก' (id 1 in
--     production) with code 'CC'. No new 'ห้องแล็บเดิม' row is ever created.
--     - If a departments row with code 'CC' exists: nothing to do.
--     - Else if a row named 'ห้องปฏิบัติการเคมีคลินิก' exists: only its code is set to 'CC'.
--     - Else (fresh / test database) that row is inserted with code 'CC'.
--     Other rows (e.g. 'งานอณูชีววิทยา') keep code NULL and is_active = true.
--   * Every existing user gets a user_departments row in the default department, marked is_default = true, with
--     role = NULL. user_departments.role is an explicit per-department OVERRIDE that only future membership
--     management sets; NULL means "use users.role". users.role is NOT copied (a copy would go stale and could
--     override later role changes, e.g. keep a demoted Admin as Admin).
--     Users created AFTER this file ran have no user_departments row. Department-aware code REJECTS a (non-Admin)
--     user without a membership row. Therefore re-running this file (idempotent) to backfill them is REQUIRED
--     immediately before turning DEPARTMENTS_ENABLED on; otherwise every user created after the first run is
--     locked out. (After that, user creation/registration code must itself write user_departments.)
-- NOT run automatically. Apply with: node scripts/apply-migration.mjs upgrade_v30_departments_core.sql --confirm-host=<host>
SET lock_timeout = '3s';

ALTER TABLE departments ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS departments_code_key ON departments (code) WHERE code IS NOT NULL;

DO $$
DECLARE
  v_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM departments WHERE code = 'CC') THEN
    RETURN;
  END IF;
  SELECT id INTO v_id FROM departments WHERE name = 'ห้องปฏิบัติการเคมีคลินิก';
  IF v_id IS NOT NULL THEN
    UPDATE departments SET code = 'CC' WHERE id = v_id;
  ELSE
    INSERT INTO departments (name, code) VALUES ('ห้องปฏิบัติการเคมีคลินิก', 'CC');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_departments (
  username text NOT NULL REFERENCES users (username) ON UPDATE CASCADE ON DELETE CASCADE,
  department_id integer NOT NULL REFERENCES departments (id),
  role text,
  is_default boolean NOT NULL DEFAULT false,
  PRIMARY KEY (username, department_id)
);

CREATE INDEX IF NOT EXISTS idx_user_departments_department ON user_departments (department_id);
-- A user has at most one default department.
CREATE UNIQUE INDEX IF NOT EXISTS user_departments_one_default_idx ON user_departments (username) WHERE is_default;

-- Backfill: every user belongs to the default department. role stays NULL (= use users.role, see header).
INSERT INTO user_departments (username, department_id, role, is_default)
SELECT u.username, d.id, NULL, true
FROM users u
CROSS JOIN (SELECT id FROM departments WHERE code = 'CC') d
ON CONFLICT (username, department_id) DO NOTHING;
