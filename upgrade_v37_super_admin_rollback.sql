-- ROLLBACK of v37: drops users.is_super_admin.
-- WARNING: this erases who is a Super admin. Export the list first:
--   SELECT username FROM users WHERE is_super_admin;
-- The app treats a missing column as "not a super admin", so rolling back is safe for the running code.
-- Idempotent.
SET lock_timeout = '3s';

ALTER TABLE IF EXISTS users DROP COLUMN IF EXISTS is_super_admin;
