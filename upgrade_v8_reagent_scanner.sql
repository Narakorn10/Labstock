-- Reagent Scanner Agent foundation: station identity, durable sync receipt,
-- and an atomic server-side withdrawal operation.

CREATE TABLE IF NOT EXISTS stations (
    station_id TEXT PRIMARY KEY,
    station_name TEXT NOT NULL,
    department_name TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS station_tokens (
    id BIGSERIAL PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    token_name TEXT NOT NULL DEFAULT 'default',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS station_user_authorizations (
    id BIGSERIAL PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES stations(station_id) ON DELETE CASCADE,
    username TEXT NOT NULL REFERENCES users(username),
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_station_user_authorizations_lookup
    ON station_user_authorizations(station_id, token_hash)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS station_withdrawals (
    id BIGSERIAL PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_hash CHAR(64) NOT NULL,
    station_id TEXT NOT NULL REFERENCES stations(station_id),
    local_queue_id TEXT NOT NULL,
    local_session_id TEXT NOT NULL,
    username TEXT NOT NULL REFERENCES users(username),
    occurred_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SYNCED', 'CONFLICT')),
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(station_id, local_queue_id)
);

CREATE TABLE IF NOT EXISTS station_withdrawal_items (
    id BIGSERIAL PRIMARY KEY,
    station_withdrawal_id BIGINT NOT NULL REFERENCES station_withdrawals(id) ON DELETE CASCADE,
    local_event_id TEXT NOT NULL,
    item_id TEXT NOT NULL REFERENCES master_data(item_id),
    lot_no TEXT NOT NULL,
    expiry_date DATE,
    quantity DECIMAL NOT NULL CHECK (quantity > 0),
    raw_barcode TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(station_withdrawal_id, local_event_id)
);

CREATE TABLE IF NOT EXISTS station_heartbeats (
    station_id TEXT PRIMARY KEY REFERENCES stations(station_id) ON DELETE CASCADE,
    agent_version TEXT NOT NULL,
    queue_pending INTEGER NOT NULL DEFAULT 0 CHECK (queue_pending >= 0),
    queue_conflict INTEGER NOT NULL DEFAULT 0 CHECK (queue_conflict >= 0),
    last_scan_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_station_withdrawals_station_processed
    ON station_withdrawals(station_id, processed_at DESC);

CREATE OR REPLACE FUNCTION process_station_withdrawal(
    p_station_id TEXT,
    p_idempotency_key TEXT,
    p_payload_hash CHAR(64),
    p_local_queue_id TEXT,
    p_local_session_id TEXT,
    p_username TEXT,
    p_occurred_at TIMESTAMPTZ,
    p_items JSONB,
    p_user_agent TEXT,
    p_ip_address TEXT
)
RETURNS TABLE (
    status TEXT,
    server_transaction_id TEXT,
    duplicate BOOLEAN,
    error_code TEXT,
    message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing station_withdrawals%ROWTYPE;
    v_withdrawal_id BIGINT;
    v_item RECORD;
    v_current_quantity DECIMAL;
    v_item_name TEXT;
BEGIN
    SELECT * INTO v_existing
    FROM station_withdrawals
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing.payload_hash <> p_payload_hash THEN
            RETURN QUERY SELECT 'REJECTED', NULL::TEXT, TRUE, 'IDEMPOTENCY_KEY_REUSED',
                'The idempotency key was already submitted with a different payload.';
        ELSE
            RETURN QUERY SELECT v_existing.status, 'SW-' || v_existing.id::TEXT, TRUE,
                v_existing.error_code, COALESCE(v_existing.error_message, 'Previously processed.');
        END IF;
        RETURN;
    END IF;

    SELECT * INTO v_existing
    FROM station_withdrawals
    WHERE station_id = p_station_id
      AND local_queue_id = p_local_queue_id;

    IF FOUND THEN
        RETURN QUERY SELECT 'REJECTED', 'SW-' || v_existing.id::TEXT, TRUE,
            'LOCAL_QUEUE_REUSED', 'The local queue ID was already submitted with another idempotency key.';
        RETURN;
    END IF;

    INSERT INTO station_withdrawals (
        idempotency_key, payload_hash, station_id, local_queue_id, local_session_id,
        username, occurred_at, status
    ) VALUES (
        p_idempotency_key, p_payload_hash, p_station_id, p_local_queue_id, p_local_session_id,
        p_username, p_occurred_at, 'CONFLICT'
    ) RETURNING id INTO v_withdrawal_id;

    -- Lock every affected lot before changing anything, so a batch is all-or-nothing.
    FOR v_item IN
        SELECT item_id, lot_no, SUM(quantity) AS quantity
        FROM jsonb_to_recordset(p_items) AS item(
            item_id TEXT, lot_no TEXT, quantity DECIMAL, local_event_id TEXT,
            expiry_date DATE, raw_barcode TEXT
        )
        GROUP BY item_id, lot_no
    LOOP
        SELECT quantity INTO v_current_quantity
        FROM inventory
        WHERE LOWER(item_id) = LOWER(v_item.item_id)
          AND lot_no = v_item.lot_no
        FOR UPDATE;

        IF NOT FOUND OR v_current_quantity < v_item.quantity THEN
            UPDATE station_withdrawals
            SET error_code = 'INSUFFICIENT_STOCK',
                error_message = 'One or more requested lots no longer have enough stock.',
                processed_at = NOW()
            WHERE id = v_withdrawal_id;

            RETURN QUERY SELECT 'CONFLICT', 'SW-' || v_withdrawal_id::TEXT, FALSE,
                'INSUFFICIENT_STOCK', 'One or more requested lots no longer have enough stock.';
            RETURN;
        END IF;
    END LOOP;

    FOR v_item IN
        SELECT *
        FROM jsonb_to_recordset(p_items) AS item(
            item_id TEXT, lot_no TEXT, quantity DECIMAL, local_event_id TEXT,
            expiry_date DATE, raw_barcode TEXT
        )
    LOOP
        UPDATE inventory
        SET quantity = quantity - v_item.quantity
        WHERE LOWER(item_id) = LOWER(v_item.item_id)
          AND lot_no = v_item.lot_no;

        SELECT name INTO v_item_name
        FROM master_data
        WHERE LOWER(item_id) = LOWER(v_item.item_id);

        INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address)
        VALUES (
            v_item.item_id, COALESCE(v_item_name, 'Unknown'), v_item.lot_no,
            'เบิกไปหน้างาน (Scanner Agent)', v_item.quantity, p_username,
            p_user_agent, p_ip_address
        );

        INSERT INTO station_withdrawal_items (
            station_withdrawal_id, local_event_id, item_id, lot_no, expiry_date, quantity, raw_barcode
        ) VALUES (
            v_withdrawal_id, v_item.local_event_id, v_item.item_id, v_item.lot_no,
            v_item.expiry_date, v_item.quantity, v_item.raw_barcode
        );
    END LOOP;

    UPDATE station_withdrawals
    SET status = 'SYNCED', error_code = NULL, error_message = NULL, processed_at = NOW()
    WHERE id = v_withdrawal_id;

    RETURN QUERY SELECT 'SYNCED', 'SW-' || v_withdrawal_id::TEXT, FALSE, NULL::TEXT,
        'Withdrawal synchronized.';
END;
$$;
