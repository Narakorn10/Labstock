-- Run once in Neon before enabling LINE LIFF approval.
-- A LINE account can be linked to only one LabStock user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS line_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_line_user_id_unique
  ON users (line_user_id)
  WHERE line_user_id IS NOT NULL;
