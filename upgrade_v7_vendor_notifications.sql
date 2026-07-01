ALTER TABLE notification_settings
ADD COLUMN IF NOT EXISTS notify_weekly_summary BOOLEAN DEFAULT true;
