import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const sql = neon(process.env.DATABASE_URL);

// Idempotent: safe to run more than once. Adds a new table only; no existing data is touched.
await sql.transaction([
  sql`
    CREATE TABLE IF NOT EXISTS app_events (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      request_id TEXT,
      username TEXT,
      role TEXT,
      action TEXT NOT NULL,
      route TEXT NOT NULL,
      method TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'error')),
      status INTEGER,
      message TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      duration_ms INTEGER
    )
  `,
  sql`CREATE INDEX IF NOT EXISTS idx_app_events_user_time ON app_events (LOWER(username), created_at DESC)`,
  sql`CREATE INDEX IF NOT EXISTS idx_app_events_time ON app_events (created_at DESC)`,
  sql`CREATE INDEX IF NOT EXISTS idx_app_events_failures ON app_events (action, created_at DESC) WHERE outcome <> 'success'`,
]);

console.log("app_events table is ready.");
