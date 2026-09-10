-- Persist private, resumable work-area stock-count sessions.

CREATE TABLE IF NOT EXISTS count_sessions (
    id BIGSERIAL PRIMARY KEY,
    owner_username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMPLETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_count_sessions_one_draft_per_owner
ON count_sessions (LOWER(owner_username))
WHERE status = 'DRAFT';

CREATE TABLE IF NOT EXISTS count_session_items (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES count_sessions(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    reagent_type TEXT NOT NULL DEFAULT '',
    job_type TEXT NOT NULL DEFAULT '',
    machine_type TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    weekly_target NUMERIC NOT NULL DEFAULT 0 CHECK (weekly_target >= 0),
    actual_quantity NUMERIC CHECK (actual_quantity >= 0),
    counted_at TIMESTAMPTZ,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_count_session_items_session
ON count_session_items (session_id, item_id);
