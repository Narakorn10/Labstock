import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const sql = neon(process.env.DATABASE_URL);

await sql.transaction([
  sql`ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS vendor TEXT,
    ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS vendor_request TEXT`,
  sql`UPDATE users SET account_status = 'active' WHERE account_status IS NULL`,
  sql`ALTER TABLE users
    ALTER COLUMN account_status SET DEFAULT 'active',
    ALTER COLUMN account_status SET NOT NULL`,
  sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check`,
  sql`ALTER TABLE users ADD CONSTRAINT users_account_status_check
    CHECK (account_status IN ('active', 'pending', 'suspended'))`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
    ON users (LOWER(email))
    WHERE email IS NOT NULL AND BTRIM(email) <> ''`,
  sql`CREATE TABLE IF NOT EXISTS vendors (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,
  sql`ALTER TABLE vendors
    ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE`,
  sql`CREATE INDEX IF NOT EXISTS vendors_approved_name_idx
    ON vendors (name)
    WHERE is_approved = TRUE`,
  sql`CREATE OR REPLACE FUNCTION enforce_active_user_sessions()
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
    $$ LANGUAGE plpgsql`,
  sql`DROP TRIGGER IF EXISTS enforce_active_user_sessions_trigger ON users`,
  sql`CREATE TRIGGER enforce_active_user_sessions_trigger
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION enforce_active_user_sessions()`,
]);

console.log("Applied email authentication registration v16 successfully.");
