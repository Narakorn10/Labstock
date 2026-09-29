-- Activity/failure log for important API actions (who did what, and why it failed).
-- Written by src/lib/app-events.ts. Rows older than 90 days are deleted by the outbox cron.
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
);

CREATE INDEX IF NOT EXISTS idx_app_events_user_time ON app_events (LOWER(username), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_time ON app_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_failures ON app_events (action, created_at DESC) WHERE outcome <> 'success';
