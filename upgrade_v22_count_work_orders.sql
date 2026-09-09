-- Persistent stock-count work orders.  This migration is intentionally staged;
-- do not apply it until the LabStock release gate is approved.

CREATE TABLE IF NOT EXISTS count_work_orders (
    id BIGSERIAL PRIMARY KEY,
    owner_username TEXT NOT NULL,
    job_type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONFIRMED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_count_work_orders_one_open_per_owner_job
ON count_work_orders (LOWER(owner_username), job_type)
WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS count_work_order_items (
    id BIGSERIAL PRIMARY KEY,
    work_order_id BIGINT NOT NULL REFERENCES count_work_orders(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    weekly_target NUMERIC NOT NULL DEFAULT 0 CHECK (weekly_target >= 0),
    counted_qty NUMERIC NOT NULL CHECK (counted_qty >= 0),
    required_qty NUMERIC NOT NULL CHECK (required_qty >= 0),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (work_order_id, item_id)
);

CREATE TABLE IF NOT EXISTS count_work_order_allocations (
    id BIGSERIAL PRIMARY KEY,
    work_order_item_id BIGINT NOT NULL REFERENCES count_work_order_items(id) ON DELETE CASCADE,
    inventory_id BIGINT NOT NULL,
    qty NUMERIC NOT NULL CHECK (qty > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (work_order_item_id, inventory_id)
);

CREATE TABLE IF NOT EXISTS count_work_order_audit (
    id BIGSERIAL PRIMARY KEY,
    work_order_id BIGINT NOT NULL REFERENCES count_work_orders(id) ON DELETE CASCADE,
    work_order_item_id BIGINT REFERENCES count_work_order_items(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    before_data JSONB,
    after_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_count_work_order_items_order ON count_work_order_items(work_order_id, item_id);
CREATE INDEX IF NOT EXISTS idx_count_work_order_audit_order ON count_work_order_audit(work_order_id, created_at DESC);
