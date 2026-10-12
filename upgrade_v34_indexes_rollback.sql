-- ROLLBACK of v34: drops only the indexes v34 created. The original indexes were never touched.
-- DROP INDEX CONCURRENTLY cannot run inside a transaction: run statement-by-statement (scripts/apply-migration.mjs).
-- Dropping per-department uniques is unsafe once a second department exists (the old global uniques may then be the
-- only protection and could already be violated by cross-department duplicates). Idempotent.
SET lock_timeout = '3s';

DROP INDEX CONCURRENTLY IF EXISTS public.uq_master_data_dept_item_code;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_master_data_item_dept;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_master_data_dept_active_item;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_vendors_dept_name;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_reagent_types_dept_name;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_job_types_dept_name;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_machine_types_dept_name;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_count_sessions_dept_one_draft_per_owner;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_count_work_orders_dept_one_open_per_owner_job;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_shipment_batches_dept_vendor_client_request;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_shipment_batches_dept_vendor_request_fingerprint;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_vendor_item_aliases_dept_vendor_item_alias;
DROP INDEX CONCURRENTLY IF EXISTS public.uq_barcode_pattern_v2_dept_active_regex;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_logs_dept_timestamp;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_purchase_orders_dept_vendor_status;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_shipments_dept_vendor;
