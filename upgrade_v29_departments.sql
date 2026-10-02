-- Department list managed in Settings; used as the dropdown on the Users page.
-- Additive and idempotent: creates one new table, does not touch existing data.
-- NOT run automatically. Run it once against the database yourself, then reload the app.
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

-- OPTIONAL: seed the list from the free-text departments users already have.
-- Review the SELECT first (it only reads), then un-comment the INSERT if the names look right.
--
-- SELECT DISTINCT TRIM(department) AS name FROM users WHERE COALESCE(TRIM(department), '') <> '' ORDER BY 1;
--
-- INSERT INTO departments (name)
-- SELECT DISTINCT TRIM(department) FROM users WHERE COALESCE(TRIM(department), '') <> ''
-- ON CONFLICT (name) DO NOTHING;
