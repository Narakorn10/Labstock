-- ROLLBACK of v33: removes the item_code trigger, function and column.
-- Run the v34 rollback first (it drops the unique index on item_code).
-- WARNING: UNSAFE once a department has item codes different from item_id (the visible codes would be lost).
-- Idempotent.
SET lock_timeout = '3s';

DROP TRIGGER IF EXISTS trg_master_data_item_code ON public.master_data;
DROP FUNCTION IF EXISTS public.master_data_set_item_code();
ALTER TABLE public.master_data DROP CONSTRAINT IF EXISTS master_data_item_code_nn;
ALTER TABLE public.master_data DROP COLUMN IF EXISTS item_code;
