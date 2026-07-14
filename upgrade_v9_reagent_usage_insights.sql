-- Reagent usage dashboard and weekly reorder-risk notification support.
ALTER TABLE notification_settings
ADD COLUMN IF NOT EXISTS notify_reorder_risk BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS reorder_risk_notification_logs (
  id SERIAL PRIMARY KEY,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL,
  notification_week_start DATE NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_id, status, notification_week_start)
);
