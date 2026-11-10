// Count work-order tables used by the Analysis "real usage" tests (copied from upgrade_v22_count_work_orders.sql).
// The production-schema fixture (pglite-prod-schema.ts) has count_work_orders but not its child tables, and the minimal
// purchase-order schema (pglite-sql.ts) has none of them.

/** Parent table without department_id: for PURCHASE_ORDER_TEST_SCHEMA (departments off). Create it BEFORE the child DDL. */
export const COUNT_WORK_ORDERS_LEGACY_DDL = `
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
`;

/** Items, allocations and audit tables (they reference count_work_orders, so create that first). */
export const COUNT_WORK_ORDER_CHILD_DDL = `
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
`;
