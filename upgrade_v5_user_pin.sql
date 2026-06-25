-- LabStock User PIN support for mobile confirm flow

ALTER TABLE users
ADD COLUMN IF NOT EXISTS pin_hash TEXT;
