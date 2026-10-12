-- v32: department_id constraints (foreign key to departments + NOT NULL).
-- Needs v30 + v31 first. Idempotent: every step is guarded, safe to run more than once.
--
-- Low-lock technique (the lock-heavy step is only a catalog change; the table scan runs with a weak lock):
--   FK:       ADD CONSTRAINT ... NOT VALID (instant)  ->  VALIDATE CONSTRAINT (scans, but does not block writes)
--   NOT NULL: ADD CHECK (department_id IS NOT NULL) NOT VALID -> VALIDATE -> SET NOT NULL (PG12+ skips the scan
--             because the validated CHECK proves it) -> DROP the helper CHECK.
-- The ADD and the VALIDATE are deliberately separate top-level statements / DO blocks: inside one transaction the
-- ACCESS EXCLUSIVE lock from the ADD would be held during the validation scan.
-- app_events.department_id stays nullable (FK only).
-- Old app INSERTs that omit department_id still work: the v31 DEFAULT supplies the default department.
-- NOT run automatically. Apply with: node scripts/apply-migration.mjs upgrade_v32_department_constraints.sql --confirm-host=<host>
SET lock_timeout = '3s';

-- master_data: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.master_data'::regclass AND conname = 'master_data_department_id_fkey') THEN
    ALTER TABLE public.master_data ADD CONSTRAINT master_data_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.master_data VALIDATE CONSTRAINT master_data_department_id_fkey;

-- master_data: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.master_data'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.master_data'::regclass AND conname = 'master_data_department_id_nn') THEN
    ALTER TABLE public.master_data ADD CONSTRAINT master_data_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.master_data'::regclass AND conname = 'master_data_department_id_nn') THEN
    ALTER TABLE public.master_data VALIDATE CONSTRAINT master_data_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.master_data'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.master_data ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.master_data'::regclass AND conname = 'master_data_department_id_nn') THEN
    ALTER TABLE public.master_data DROP CONSTRAINT master_data_department_id_nn;
  END IF;
END $$;

-- inventory: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inventory'::regclass AND conname = 'inventory_department_id_fkey') THEN
    ALTER TABLE public.inventory ADD CONSTRAINT inventory_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.inventory VALIDATE CONSTRAINT inventory_department_id_fkey;

-- inventory: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.inventory'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inventory'::regclass AND conname = 'inventory_department_id_nn') THEN
    ALTER TABLE public.inventory ADD CONSTRAINT inventory_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inventory'::regclass AND conname = 'inventory_department_id_nn') THEN
    ALTER TABLE public.inventory VALIDATE CONSTRAINT inventory_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.inventory'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.inventory ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inventory'::regclass AND conname = 'inventory_department_id_nn') THEN
    ALTER TABLE public.inventory DROP CONSTRAINT inventory_department_id_nn;
  END IF;
END $$;

-- logs: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.logs'::regclass AND conname = 'logs_department_id_fkey') THEN
    ALTER TABLE public.logs ADD CONSTRAINT logs_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.logs VALIDATE CONSTRAINT logs_department_id_fkey;

-- logs: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.logs'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.logs'::regclass AND conname = 'logs_department_id_nn') THEN
    ALTER TABLE public.logs ADD CONSTRAINT logs_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.logs'::regclass AND conname = 'logs_department_id_nn') THEN
    ALTER TABLE public.logs VALIDATE CONSTRAINT logs_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.logs'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.logs ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.logs'::regclass AND conname = 'logs_department_id_nn') THEN
    ALTER TABLE public.logs DROP CONSTRAINT logs_department_id_nn;
  END IF;
END $$;

-- vendors: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendors'::regclass AND conname = 'vendors_department_id_fkey') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_department_id_fkey;

-- vendors: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.vendors'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendors'::regclass AND conname = 'vendors_department_id_nn') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendors'::regclass AND conname = 'vendors_department_id_nn') THEN
    ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.vendors'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.vendors ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendors'::regclass AND conname = 'vendors_department_id_nn') THEN
    ALTER TABLE public.vendors DROP CONSTRAINT vendors_department_id_nn;
  END IF;
END $$;

-- vendor_item_aliases: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendor_item_aliases'::regclass AND conname = 'vendor_item_aliases_department_id_fkey') THEN
    ALTER TABLE public.vendor_item_aliases ADD CONSTRAINT vendor_item_aliases_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.vendor_item_aliases VALIDATE CONSTRAINT vendor_item_aliases_department_id_fkey;

-- vendor_item_aliases: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.vendor_item_aliases'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendor_item_aliases'::regclass AND conname = 'vendor_item_aliases_department_id_nn') THEN
    ALTER TABLE public.vendor_item_aliases ADD CONSTRAINT vendor_item_aliases_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendor_item_aliases'::regclass AND conname = 'vendor_item_aliases_department_id_nn') THEN
    ALTER TABLE public.vendor_item_aliases VALIDATE CONSTRAINT vendor_item_aliases_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.vendor_item_aliases'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.vendor_item_aliases ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendor_item_aliases'::regclass AND conname = 'vendor_item_aliases_department_id_nn') THEN
    ALTER TABLE public.vendor_item_aliases DROP CONSTRAINT vendor_item_aliases_department_id_nn;
  END IF;
END $$;

-- purchase_orders: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchase_orders'::regclass AND conname = 'purchase_orders_department_id_fkey') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.purchase_orders VALIDATE CONSTRAINT purchase_orders_department_id_fkey;

-- purchase_orders: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.purchase_orders'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchase_orders'::regclass AND conname = 'purchase_orders_department_id_nn') THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchase_orders'::regclass AND conname = 'purchase_orders_department_id_nn') THEN
    ALTER TABLE public.purchase_orders VALIDATE CONSTRAINT purchase_orders_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.purchase_orders'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.purchase_orders ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchase_orders'::regclass AND conname = 'purchase_orders_department_id_nn') THEN
    ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_department_id_nn;
  END IF;
END $$;

-- shipments: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shipments'::regclass AND conname = 'shipments_department_id_fkey') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.shipments VALIDATE CONSTRAINT shipments_department_id_fkey;

-- shipments: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.shipments'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shipments'::regclass AND conname = 'shipments_department_id_nn') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shipments'::regclass AND conname = 'shipments_department_id_nn') THEN
    ALTER TABLE public.shipments VALIDATE CONSTRAINT shipments_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.shipments'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.shipments ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shipments'::regclass AND conname = 'shipments_department_id_nn') THEN
    ALTER TABLE public.shipments DROP CONSTRAINT shipments_department_id_nn;
  END IF;
END $$;

-- shipment_batches: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shipment_batches'::regclass AND conname = 'shipment_batches_department_id_fkey') THEN
    ALTER TABLE public.shipment_batches ADD CONSTRAINT shipment_batches_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.shipment_batches VALIDATE CONSTRAINT shipment_batches_department_id_fkey;

-- shipment_batches: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.shipment_batches'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shipment_batches'::regclass AND conname = 'shipment_batches_department_id_nn') THEN
    ALTER TABLE public.shipment_batches ADD CONSTRAINT shipment_batches_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shipment_batches'::regclass AND conname = 'shipment_batches_department_id_nn') THEN
    ALTER TABLE public.shipment_batches VALIDATE CONSTRAINT shipment_batches_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.shipment_batches'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.shipment_batches ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shipment_batches'::regclass AND conname = 'shipment_batches_department_id_nn') THEN
    ALTER TABLE public.shipment_batches DROP CONSTRAINT shipment_batches_department_id_nn;
  END IF;
END $$;

-- count_sessions: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.count_sessions'::regclass AND conname = 'count_sessions_department_id_fkey') THEN
    ALTER TABLE public.count_sessions ADD CONSTRAINT count_sessions_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.count_sessions VALIDATE CONSTRAINT count_sessions_department_id_fkey;

-- count_sessions: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.count_sessions'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.count_sessions'::regclass AND conname = 'count_sessions_department_id_nn') THEN
    ALTER TABLE public.count_sessions ADD CONSTRAINT count_sessions_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.count_sessions'::regclass AND conname = 'count_sessions_department_id_nn') THEN
    ALTER TABLE public.count_sessions VALIDATE CONSTRAINT count_sessions_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.count_sessions'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.count_sessions ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.count_sessions'::regclass AND conname = 'count_sessions_department_id_nn') THEN
    ALTER TABLE public.count_sessions DROP CONSTRAINT count_sessions_department_id_nn;
  END IF;
END $$;

-- count_work_orders: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.count_work_orders'::regclass AND conname = 'count_work_orders_department_id_fkey') THEN
    ALTER TABLE public.count_work_orders ADD CONSTRAINT count_work_orders_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.count_work_orders VALIDATE CONSTRAINT count_work_orders_department_id_fkey;

-- count_work_orders: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.count_work_orders'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.count_work_orders'::regclass AND conname = 'count_work_orders_department_id_nn') THEN
    ALTER TABLE public.count_work_orders ADD CONSTRAINT count_work_orders_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.count_work_orders'::regclass AND conname = 'count_work_orders_department_id_nn') THEN
    ALTER TABLE public.count_work_orders VALIDATE CONSTRAINT count_work_orders_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.count_work_orders'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.count_work_orders ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.count_work_orders'::regclass AND conname = 'count_work_orders_department_id_nn') THEN
    ALTER TABLE public.count_work_orders DROP CONSTRAINT count_work_orders_department_id_nn;
  END IF;
END $$;

-- reagent_loans: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reagent_loans'::regclass AND conname = 'reagent_loans_department_id_fkey') THEN
    ALTER TABLE public.reagent_loans ADD CONSTRAINT reagent_loans_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.reagent_loans VALIDATE CONSTRAINT reagent_loans_department_id_fkey;

-- reagent_loans: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reagent_loans'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reagent_loans'::regclass AND conname = 'reagent_loans_department_id_nn') THEN
    ALTER TABLE public.reagent_loans ADD CONSTRAINT reagent_loans_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reagent_loans'::regclass AND conname = 'reagent_loans_department_id_nn') THEN
    ALTER TABLE public.reagent_loans VALIDATE CONSTRAINT reagent_loans_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reagent_loans'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.reagent_loans ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reagent_loans'::regclass AND conname = 'reagent_loans_department_id_nn') THEN
    ALTER TABLE public.reagent_loans DROP CONSTRAINT reagent_loans_department_id_nn;
  END IF;
END $$;

-- barcode_pattern_v2: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.barcode_pattern_v2'::regclass AND conname = 'barcode_pattern_v2_department_id_fkey') THEN
    ALTER TABLE public.barcode_pattern_v2 ADD CONSTRAINT barcode_pattern_v2_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.barcode_pattern_v2 VALIDATE CONSTRAINT barcode_pattern_v2_department_id_fkey;

-- barcode_pattern_v2: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.barcode_pattern_v2'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.barcode_pattern_v2'::regclass AND conname = 'barcode_pattern_v2_department_id_nn') THEN
    ALTER TABLE public.barcode_pattern_v2 ADD CONSTRAINT barcode_pattern_v2_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.barcode_pattern_v2'::regclass AND conname = 'barcode_pattern_v2_department_id_nn') THEN
    ALTER TABLE public.barcode_pattern_v2 VALIDATE CONSTRAINT barcode_pattern_v2_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.barcode_pattern_v2'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.barcode_pattern_v2 ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.barcode_pattern_v2'::regclass AND conname = 'barcode_pattern_v2_department_id_nn') THEN
    ALTER TABLE public.barcode_pattern_v2 DROP CONSTRAINT barcode_pattern_v2_department_id_nn;
  END IF;
END $$;

-- barcode_patterns: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.barcode_patterns'::regclass AND conname = 'barcode_patterns_department_id_fkey') THEN
    ALTER TABLE public.barcode_patterns ADD CONSTRAINT barcode_patterns_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.barcode_patterns VALIDATE CONSTRAINT barcode_patterns_department_id_fkey;

-- barcode_patterns: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.barcode_patterns'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.barcode_patterns'::regclass AND conname = 'barcode_patterns_department_id_nn') THEN
    ALTER TABLE public.barcode_patterns ADD CONSTRAINT barcode_patterns_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.barcode_patterns'::regclass AND conname = 'barcode_patterns_department_id_nn') THEN
    ALTER TABLE public.barcode_patterns VALIDATE CONSTRAINT barcode_patterns_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.barcode_patterns'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.barcode_patterns ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.barcode_patterns'::regclass AND conname = 'barcode_patterns_department_id_nn') THEN
    ALTER TABLE public.barcode_patterns DROP CONSTRAINT barcode_patterns_department_id_nn;
  END IF;
END $$;

-- notification_outbox: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notification_outbox'::regclass AND conname = 'notification_outbox_department_id_fkey') THEN
    ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.notification_outbox VALIDATE CONSTRAINT notification_outbox_department_id_fkey;

-- notification_outbox: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notification_outbox'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notification_outbox'::regclass AND conname = 'notification_outbox_department_id_nn') THEN
    ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notification_outbox'::regclass AND conname = 'notification_outbox_department_id_nn') THEN
    ALTER TABLE public.notification_outbox VALIDATE CONSTRAINT notification_outbox_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notification_outbox'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.notification_outbox ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notification_outbox'::regclass AND conname = 'notification_outbox_department_id_nn') THEN
    ALTER TABLE public.notification_outbox DROP CONSTRAINT notification_outbox_department_id_nn;
  END IF;
END $$;

-- reagent_types: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reagent_types'::regclass AND conname = 'reagent_types_department_id_fkey') THEN
    ALTER TABLE public.reagent_types ADD CONSTRAINT reagent_types_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.reagent_types VALIDATE CONSTRAINT reagent_types_department_id_fkey;

-- reagent_types: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reagent_types'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reagent_types'::regclass AND conname = 'reagent_types_department_id_nn') THEN
    ALTER TABLE public.reagent_types ADD CONSTRAINT reagent_types_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reagent_types'::regclass AND conname = 'reagent_types_department_id_nn') THEN
    ALTER TABLE public.reagent_types VALIDATE CONSTRAINT reagent_types_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reagent_types'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.reagent_types ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reagent_types'::regclass AND conname = 'reagent_types_department_id_nn') THEN
    ALTER TABLE public.reagent_types DROP CONSTRAINT reagent_types_department_id_nn;
  END IF;
END $$;

-- job_types: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.job_types'::regclass AND conname = 'job_types_department_id_fkey') THEN
    ALTER TABLE public.job_types ADD CONSTRAINT job_types_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.job_types VALIDATE CONSTRAINT job_types_department_id_fkey;

-- job_types: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.job_types'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.job_types'::regclass AND conname = 'job_types_department_id_nn') THEN
    ALTER TABLE public.job_types ADD CONSTRAINT job_types_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.job_types'::regclass AND conname = 'job_types_department_id_nn') THEN
    ALTER TABLE public.job_types VALIDATE CONSTRAINT job_types_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.job_types'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.job_types ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.job_types'::regclass AND conname = 'job_types_department_id_nn') THEN
    ALTER TABLE public.job_types DROP CONSTRAINT job_types_department_id_nn;
  END IF;
END $$;

-- machine_types: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.machine_types'::regclass AND conname = 'machine_types_department_id_fkey') THEN
    ALTER TABLE public.machine_types ADD CONSTRAINT machine_types_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.machine_types VALIDATE CONSTRAINT machine_types_department_id_fkey;

-- machine_types: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.machine_types'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.machine_types'::regclass AND conname = 'machine_types_department_id_nn') THEN
    ALTER TABLE public.machine_types ADD CONSTRAINT machine_types_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.machine_types'::regclass AND conname = 'machine_types_department_id_nn') THEN
    ALTER TABLE public.machine_types VALIDATE CONSTRAINT machine_types_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.machine_types'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.machine_types ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.machine_types'::regclass AND conname = 'machine_types_department_id_nn') THEN
    ALTER TABLE public.machine_types DROP CONSTRAINT machine_types_department_id_nn;
  END IF;
END $$;

-- lab_profile: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.lab_profile'::regclass AND conname = 'lab_profile_department_id_fkey') THEN
    ALTER TABLE public.lab_profile ADD CONSTRAINT lab_profile_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.lab_profile VALIDATE CONSTRAINT lab_profile_department_id_fkey;

-- lab_profile: NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.lab_profile'::regclass AND attname = 'department_id' AND NOT attnotnull)
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.lab_profile'::regclass AND conname = 'lab_profile_department_id_nn') THEN
    ALTER TABLE public.lab_profile ADD CONSTRAINT lab_profile_department_id_nn CHECK (department_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.lab_profile'::regclass AND conname = 'lab_profile_department_id_nn') THEN
    ALTER TABLE public.lab_profile VALIDATE CONSTRAINT lab_profile_department_id_nn;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.lab_profile'::regclass AND attname = 'department_id' AND NOT attnotnull) THEN
    ALTER TABLE public.lab_profile ALTER COLUMN department_id SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.lab_profile'::regclass AND conname = 'lab_profile_department_id_nn') THEN
    ALTER TABLE public.lab_profile DROP CONSTRAINT lab_profile_department_id_nn;
  END IF;
END $$;

-- app_events: foreign key
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.app_events'::regclass AND conname = 'app_events_department_id_fkey') THEN
    ALTER TABLE public.app_events ADD CONSTRAINT app_events_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments (id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.app_events VALIDATE CONSTRAINT app_events_department_id_fkey;
