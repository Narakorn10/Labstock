ALTER TABLE notification_settings
ADD COLUMN IF NOT EXISTS notify_expiring_soon BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS expiry_notification_logs (
  id SERIAL PRIMARY KEY,
  item_id TEXT NOT NULL,
  lot_no TEXT NOT NULL,
  exp_date DATE NOT NULL,
  notification_type TEXT NOT NULL DEFAULT 'EXPIRING_SOON_30D',
  notified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_line_user_id TEXT,
  UNIQUE (item_id, lot_no, exp_date, notification_type)
);

ALTER TABLE expiry_notification_logs
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

ALTER TABLE expiry_notification_logs
ADD COLUMN IF NOT EXISTS acknowledged_by_line_user_id TEXT;
