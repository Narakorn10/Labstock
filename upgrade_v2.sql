-- 🚀 LabStock Modernization Migration (v2)
-- Grounded in PostgreSQL Design Best Practices (NotebookLM + Antigravity)

-- 1. เพิ่มระบบจัดการ Updated At อัตโนมัติ (Trigger Function)
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 2. ยกระดับโครงสร้างตารางเดิม (Audit Fields & Constraints)

-- ตาราง Users
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

DROP TRIGGER IF EXISTS update_users_modtime ON users;
CREATE TRIGGER update_users_modtime BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- ตาราง Master Data
ALTER TABLE master_data 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ALTER COLUMN min_threshold SET DEFAULT 0,
ALTER COLUMN weekly_target SET DEFAULT 0;

-- เพิ่ม Foreign Keys (Data Integrity)
ALTER TABLE master_data
DROP CONSTRAINT IF EXISTS fk_reagent_type,
DROP CONSTRAINT IF EXISTS fk_job_type,
DROP CONSTRAINT IF EXISTS fk_machine_type;

ALTER TABLE master_data
ADD CONSTRAINT fk_reagent_type FOREIGN KEY (reagent_type) REFERENCES reagent_types(name) ON UPDATE CASCADE,
ADD CONSTRAINT fk_job_type FOREIGN KEY (job_type) REFERENCES job_types(name) ON UPDATE CASCADE,
ADD CONSTRAINT fk_machine_type FOREIGN KEY (machine_type) REFERENCES machine_types(name) ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS update_master_modtime ON master_data;
CREATE TRIGGER update_master_modtime BEFORE UPDATE ON master_data FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- ตาราง Inventory
ALTER TABLE inventory 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS check_positive_qty;
ALTER TABLE inventory ADD CONSTRAINT check_positive_qty CHECK (quantity >= 0);

-- แปลง exp_date เป็น DATE
DO $$ 
BEGIN 
    BEGIN
        ALTER TABLE inventory ALTER COLUMN exp_date TYPE DATE USING exp_date::DATE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'exp_date already converted or conversion failed';
    END;
END $$;

DROP TRIGGER IF EXISTS update_inventory_modtime ON inventory;
CREATE TRIGGER update_inventory_modtime BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- ตาราง Shipments (หากมี)
ALTER TABLE shipments
ALTER COLUMN exp_date TYPE DATE USING exp_date::DATE,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

DROP TRIGGER IF EXISTS update_shipments_modtime ON shipments;
CREATE TRIGGER update_shipments_modtime BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- 3. การเพิ่มประสิทธิภาพ (Performance Indexing)
CREATE INDEX IF NOT EXISTS idx_master_barcode ON master_data(barcode);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_item ON inventory(item_id);
CREATE INDEX IF NOT EXISTS idx_logs_item ON logs(item_id);

-- 4. ตรวจเช็คโครงสร้าง Logs (Audit Trail Enhancement)
ALTER TABLE logs 
ADD COLUMN IF NOT EXISTS user_agent TEXT,
ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- 5. สรุปผล
DO $$ 
BEGIN 
    RAISE NOTICE 'Database Modernization (v2) applied successfully!';
END $$;
