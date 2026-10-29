-- v37 grant: make user '5783' the Super admin. Run ONLY after upgrade_v37_super_admin.sql, and only with the owner's approval.
-- Touches at most one row: the user must exist, be role 'Admin' and be active. Otherwise nothing changes.
-- Check afterwards (read only): SELECT username, role, is_super_admin FROM users WHERE is_super_admin;  -- expect only 5783
-- NOT run automatically. Apply with: node scripts/apply-migration.mjs upgrade_v37_super_admin_grant.sql --confirm-host=<host>
SET lock_timeout = '3s';

UPDATE users SET is_super_admin = true WHERE username = '5783' AND role = 'Admin' AND account_status = 'active';
