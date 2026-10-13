-- ROLLBACK of v35: drops the room admin slot index and the user_departments.admin_slot column.
-- WARNING: this erases who is a room admin. Export the list first:
--   SELECT username, department_id, admin_slot FROM user_departments WHERE admin_slot IS NOT NULL;
-- Run this BEFORE the v30 rollback (v30 drops user_departments). Idempotent (also fine if v30 was already rolled back).
SET lock_timeout = '3s';

DROP INDEX IF EXISTS user_departments_admin_slot_idx;
ALTER TABLE IF EXISTS user_departments DROP COLUMN IF EXISTS admin_slot;
