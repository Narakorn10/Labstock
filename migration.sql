-- LabStock Migration to Neon (PostgreSQL)
-- Schema Definition

-- 1. Master Lists (Settings)
CREATE TABLE IF NOT EXISTS reagent_types (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS job_types (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS machine_types (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'User',
    company TEXT DEFAULT '',
    token TEXT,
    token_expiry TIMESTAMP
);

-- 3. Master Data (Reagents)
CREATE TABLE IF NOT EXISTS master_data (
    item_id TEXT PRIMARY KEY,
    barcode TEXT,
    name TEXT NOT NULL,
    reagent_type TEXT,
    job_type TEXT,
    machine_type TEXT,
    unit TEXT,
    min_threshold INTEGER DEFAULT 0,
    weekly_target INTEGER DEFAULT 0,
    vendor TEXT
);

-- 4. Inventory (Lots)
CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    item_id TEXT REFERENCES master_data(item_id) ON DELETE CASCADE,
    lot_no TEXT NOT NULL,
    exp_date TEXT, -- Keeping as TEXT to match original format, or use DATE
    quantity DECIMAL NOT NULL DEFAULT 0,
    UNIQUE(item_id, lot_no)
);

-- 5. Logs (Transactions)
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    item_id TEXT,
    name TEXT,
    lot_no TEXT,
    action TEXT NOT NULL,
    quantity DECIMAL,
    username TEXT -- changed from 'user' because it's a reserved word in PG
);

-- Initial Admin User (Default password is 'admin123' hashed)
-- You can change this later
INSERT INTO users (username, password_hash, name, role)
VALUES ('admin', 'ef71168449c47069507f3ed639d67d2e098679f13459c3821a81e94119d20c5c', 'System Admin', 'Admin')
ON CONFLICT (username) DO NOTHING;
