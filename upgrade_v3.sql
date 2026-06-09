-- 🚀 Advanced LabStock Modernization (v3)
-- Based on NotebookLM Recommendations & R2R Readiness

-- 1. Create Dedicated Vendors Table (Normalization)
CREATE TABLE IF NOT EXISTS vendors (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migrating existing vendors from master_data
INSERT INTO vendors (name)
SELECT DISTINCT vendor FROM master_data 
WHERE vendor IS NOT NULL AND vendor != ''
ON CONFLICT (name) DO NOTHING;

-- 2. Update master_data to use vendor_id instead of string
ALTER TABLE master_data ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL;

-- Link existing master_data to new vendor IDs
UPDATE master_data m
SET vendor_id = v.id
FROM vendors v
WHERE m.vendor = v.name;

-- 3. Create Target History Table (Critical for R2R research)
-- Tracks changes in weekly_target and min_threshold over time
CREATE TABLE IF NOT EXISTS target_history (
    id SERIAL PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES master_data(item_id) ON DELETE CASCADE,
    old_min_threshold INTEGER,
    new_min_threshold INTEGER,
    old_weekly_target INTEGER,
    new_weekly_target INTEGER,
    changed_by TEXT,
    reason TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Create Trigger to automatically record target changes
CREATE OR REPLACE FUNCTION log_target_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.min_threshold IS DISTINCT FROM NEW.min_threshold OR 
        OLD.weekly_target IS DISTINCT FROM NEW.weekly_target) THEN
        INSERT INTO target_history (
            item_id, 
            old_min_threshold, new_min_threshold, 
            old_weekly_target, new_weekly_target, 
            changed_at
        )
        VALUES (
            NEW.item_id, 
            OLD.min_threshold, NEW.min_threshold, 
            OLD.weekly_target, NEW.weekly_target, 
            now()
        );
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trigger_log_target_changes ON master_data;
CREATE TRIGGER trigger_log_target_changes
AFTER UPDATE ON master_data
FOR EACH ROW
EXECUTE PROCEDURE log_target_changes();

-- 5. Add Audit Triggers for Vendors
DROP TRIGGER IF EXISTS update_vendors_modtime ON vendors;
CREATE TRIGGER update_vendors_modtime BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- Summary Notice
DO $$ 
BEGIN 
    RAISE NOTICE 'Advanced Database Modernization (v3) - Vendors & R2R readiness applied!';
END $$;
