-- v35: room admin ("ผู้ดูแลห้อง") slot on user_departments.
-- A department has at most 2 room admins. admin_slot is 1 or 2 (NULL = not a room admin); the partial unique index
-- below makes "max 2 per room, no duplicate slot" a database guarantee instead of an application check.
-- Additive and idempotent: safe to run more than once. Nothing is renamed, deleted, or backfilled.
-- No row gets a slot here: appointing a room admin is done by a system Admin through the app (later PR).
-- Does NOT lock any rule: existing roles, effectiveRole and every v30-v34 behavior stay exactly as they are.
-- Requires v30 (user_departments). Rolling back: run upgrade_v35_room_admin_slot_rollback.sql BEFORE the v30 rollback.
-- A stricter-rules migration (if ever wanted) must use v36 or later.
-- NOT run automatically. Apply with: node scripts/apply-migration.mjs upgrade_v35_room_admin_slot.sql --confirm-host=<host>
SET lock_timeout = '3s';

ALTER TABLE user_departments ADD COLUMN IF NOT EXISTS admin_slot smallint CHECK (admin_slot IN (1, 2));

CREATE UNIQUE INDEX IF NOT EXISTS user_departments_admin_slot_idx
  ON user_departments (department_id, admin_slot) WHERE admin_slot IS NOT NULL;
