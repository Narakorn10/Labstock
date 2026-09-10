-- Additive QR/Barcode Learning V2. This migration never changes barcode_patterns.
-- Keep BARCODE_LEARNING_V2_RUNTIME_ENABLED unset/false until the regression gate passes.

CREATE TABLE IF NOT EXISTS barcode_pattern_v2 (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'VERIFIED', 'ACTIVE', 'INACTIVE')),
    mapping_mode TEXT NOT NULL
        CHECK (mapping_mode IN ('CAPTURED_IDENTIFIER', 'FIXED_REAGENT')),
    fixed_item_id TEXT REFERENCES master_data(item_id),
    regex_pattern TEXT NOT NULL,
    item_id_group INTEGER,
    lot_no_group INTEGER,
    exp_date_group INTEGER,
    examples JSONB NOT NULL DEFAULT '[]'::jsonb,
    verification JSONB NOT NULL DEFAULT '{"status":"UNVERIFIED","errors":[]}'::jsonb,
    created_by TEXT REFERENCES users(username),
    updated_by TEXT REFERENCES users(username),
    activated_by TEXT REFERENCES users(username),
    deactivated_by TEXT REFERENCES users(username),
    deactivation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    CONSTRAINT barcode_pattern_v2_mapping_check CHECK (
        (mapping_mode = 'FIXED_REAGENT' AND fixed_item_id IS NOT NULL)
        OR (mapping_mode = 'CAPTURED_IDENTIFIER' AND fixed_item_id IS NULL)
    ),
    CONSTRAINT barcode_pattern_v2_groups_check CHECK (
        COALESCE(item_id_group, 0) >= 0
        AND COALESCE(lot_no_group, 0) >= 0
        AND COALESCE(exp_date_group, 0) >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_barcode_pattern_v2_runtime
    ON barcode_pattern_v2 (status, created_at DESC);

-- Exact duplicates are never meaningful at runtime. This is a database-side
-- guard in addition to the evidence-based collision check in the API.
CREATE UNIQUE INDEX IF NOT EXISTS uq_barcode_pattern_v2_active_regex
    ON barcode_pattern_v2 (regex_pattern)
    WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS barcode_pattern_v2_audit (
    id BIGSERIAL PRIMARY KEY,
    -- Keep this value after a draft is deleted; it is a historical reference,
    -- not a live foreign key. The DELETE snapshot also retains the full row.
    pattern_id BIGINT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'VALIDATE', 'ACTIVATE', 'DEACTIVATE', 'DELETE')),
    actor TEXT NOT NULL REFERENCES users(username),
    reason TEXT,
    before_json JSONB,
    after_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If an early V19 preview was applied, remove the old cascading FK so a DELETE
-- audit record survives. This touches V2 audit only and never alters V1 tables.
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'barcode_pattern_v2_audit'::regclass
          AND contype = 'f'
          AND confrelid = 'barcode_pattern_v2'::regclass
    LOOP
        EXECUTE format('ALTER TABLE barcode_pattern_v2_audit DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_barcode_pattern_v2_audit_pattern
    ON barcode_pattern_v2_audit (pattern_id, created_at DESC);
