-- LabStock Email Authentication Phase 1
--
-- Production gate: this migration provides registration and pending approval
-- only. Email verification and password reset are deliberately not implemented
-- in this phase. Do not open public enrollment until an administrator-owned
-- activation process and email-verification delivery are in place.

BEGIN;

-- Existing accounts remain active so legacy username, Google, and LINE flows
-- continue to work after the migration.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS vendor TEXT,
  ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS vendor_request TEXT;

UPDATE users
SET account_status = 'active'
WHERE account_status IS NULL;

ALTER TABLE users
  ALTER COLUMN account_status SET DEFAULT 'active',
  ALTER COLUMN account_status SET NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('active', 'pending', 'suspended'));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (LOWER(email))
  WHERE email IS NOT NULL AND BTRIM(email) <> '';

-- `vendors` is the approved-company directory. Existing vendors are treated as
-- approved, while registration never creates a row here or assigns a requested
-- company to a user.
CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS vendors_approved_name_idx
  ON vendors (name)
  WHERE is_approved = TRUE;

-- Clearing sessions on any non-active account keeps existing token-based
-- endpoints fail-closed even if another login provider attempts to issue one.
CREATE OR REPLACE FUNCTION enforce_active_user_sessions()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_status <> 'active' THEN
    IF NEW.token IS DISTINCT FROM OLD.token
      OR NEW.token_expiry IS DISTINCT FROM OLD.token_expiry THEN
      RAISE EXCEPTION 'Non-active accounts cannot receive a session token';
    END IF;

    NEW.token = NULL;
    NEW.token_expiry = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_active_user_sessions_trigger ON users;
CREATE TRIGGER enforce_active_user_sessions_trigger
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION enforce_active_user_sessions();

COMMIT;
