-- v34: per-department unique and search indexes, created ALONGSIDE the existing ones (nothing is dropped here;
-- swapping the old uniques out is a later step).
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction block. The runner must execute this file
-- statement-by-statement (scripts/apply-migration.mjs does), never as one multi-statement query or inside BEGIN/COMMIT.
-- Needs v31 (department_id) and v33 (item_code) first.
--
-- Idempotent: CREATE ... IF NOT EXISTS. CAUTION: if a CONCURRENTLY build is interrupted it leaves an INVALID index
-- and IF NOT EXISTS would skip it on re-run. The DO block at the end raises if any index created here is invalid;
-- drop that index (DROP INDEX CONCURRENTLY <name>) and re-run.
-- The unique indexes cannot fail on today's data (everything is in one department, and each new key is the old key
-- plus department_id). If one does fail, stop and investigate; do not force it.
-- NOT run automatically. Apply with: node scripts/apply-migration.mjs upgrade_v34_indexes.sql --confirm-host=<host>
SET lock_timeout = '3s';

-- master_data
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_master_data_dept_item_code ON public.master_data (department_id, item_code);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_master_data_item_dept ON public.master_data (item_id, department_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_master_data_dept_active_item ON public.master_data (department_id, is_active, item_id);

-- vendors and type lists
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_vendors_dept_name ON public.vendors (department_id, name);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_reagent_types_dept_name ON public.reagent_types (department_id, name);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_job_types_dept_name ON public.job_types (department_id, name);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_machine_types_dept_name ON public.machine_types (department_id, name);

-- counting (mirrors idx_count_sessions_one_draft_per_owner / idx_count_work_orders_one_open_per_owner_job)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_count_sessions_dept_one_draft_per_owner
  ON public.count_sessions (department_id, lower(owner_username)) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_count_work_orders_dept_one_open_per_owner_job
  ON public.count_work_orders (department_id, lower(owner_username), job_type) WHERE status = 'OPEN';

-- shipment batches (mirrors uq_shipment_batches_vendor_client_request / _vendor_request_fingerprint)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_shipment_batches_dept_vendor_client_request
  ON public.shipment_batches (department_id, vendor, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_shipment_batches_dept_vendor_request_fingerprint
  ON public.shipment_batches (department_id, vendor, request_fingerprint) WHERE request_fingerprint IS NOT NULL;

-- vendor item aliases (mirrors UNIQUE (vendor, item_id, alias))
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_vendor_item_aliases_dept_vendor_item_alias
  ON public.vendor_item_aliases (department_id, vendor, item_id, alias);

-- barcode pattern v2: one ACTIVE regex per department (mirrors uq_barcode_pattern_v2_active_regex)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_barcode_pattern_v2_dept_active_regex
  ON public.barcode_pattern_v2 (department_id, regex_pattern) WHERE status = 'ACTIVE';

-- search indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_dept_timestamp ON public.logs (department_id, "timestamp" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_dept_vendor_status ON public.purchase_orders (department_id, vendor, status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipments_dept_vendor ON public.shipments (department_id, vendor);

-- Verification: none of the indexes above may be left INVALID by an interrupted build.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE NOT i.indisvalid
    AND c.relname IN (
      'uq_master_data_dept_item_code', 'uq_master_data_item_dept', 'idx_master_data_dept_active_item',
      'uq_vendors_dept_name', 'uq_reagent_types_dept_name', 'uq_job_types_dept_name', 'uq_machine_types_dept_name',
      'uq_count_sessions_dept_one_draft_per_owner', 'uq_count_work_orders_dept_one_open_per_owner_job',
      'uq_shipment_batches_dept_vendor_client_request', 'uq_shipment_batches_dept_vendor_request_fingerprint',
      'uq_vendor_item_aliases_dept_vendor_item_alias', 'uq_barcode_pattern_v2_dept_active_regex',
      'idx_logs_dept_timestamp', 'idx_purchase_orders_dept_vendor_status', 'idx_shipments_dept_vendor'
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'v34 verification failed: invalid indexes (drop them with DROP INDEX CONCURRENTLY and re-run): %', bad;
  END IF;
END $$;
