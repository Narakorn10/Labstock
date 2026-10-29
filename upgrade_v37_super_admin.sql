-- v37: Super admin flag on users.
-- users.is_super_admin marks the (single) person who may manage rooms (departments) through the app. It is a SEPARATE
-- flag, not a new role: that person stays role = 'Admin', so every existing role check keeps working unchanged.
-- Additive and idempotent: safe to run more than once. Nothing is renamed, deleted or backfilled; every user gets false.
-- Nobody is granted here. Use upgrade_v37_super_admin_grant.sql (reviewed and run by the owner) to set the flag.
-- The app treats a missing column as "not a super admin", so the code can be deployed before or after this file.
-- Rolling back: run upgrade_v37_super_admin_rollback.sql.
-- NOT run automatically. Apply with: node scripts/apply-migration.mjs upgrade_v37_super_admin.sql --confirm-host=<host>
SET lock_timeout = '3s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;
