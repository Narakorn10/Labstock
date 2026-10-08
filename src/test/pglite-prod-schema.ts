// DDL that mirrors the REAL production definitions (read from Neon with describe_table_schema, 2026-10-08)
// of ONLY the tables touched by upgrade_v30..v34 (plus the tables their foreign keys point at).
// Kept separate from pglite-sql.ts, whose slimmed-down schema the other db tests depend on.
// Differences from production on purpose: none in columns/constraints/indexes; sequences are created implicitly by
// SERIAL/BIGSERIAL instead of the production sequence names.

export const PROD_SCHEMA_DDL = `
  CREATE TABLE departments (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'User',
    vendor TEXT DEFAULT '',
    token TEXT,
    token_expiry TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    pin_hash TEXT,
    line_user_id TEXT,
    email TEXT,
    account_status TEXT NOT NULL DEFAULT 'active' CONSTRAINT users_account_status_check CHECK (account_status = ANY (ARRAY['active','pending','suspended'])),
    vendor_request TEXT,
    session_version INTEGER NOT NULL DEFAULT 1,
    department TEXT CONSTRAINT users_department_check CHECK (department IS NULL OR char_length(department) <= 160)
  );
  CREATE UNIQUE INDEX users_line_user_id_unique ON users (line_user_id) WHERE line_user_id IS NOT NULL;
  CREATE INDEX idx_users_token ON users (token);
  CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email)) WHERE email IS NOT NULL AND btrim(email) <> '';

  CREATE TABLE reagent_types (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE);
  CREATE TABLE job_types (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE);
  CREATE TABLE machine_types (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE);

  CREATE TABLE vendors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    is_approved BOOLEAN NOT NULL DEFAULT true
  );
  CREATE INDEX vendors_approved_name_idx ON vendors (name) WHERE is_approved = true;

  CREATE SEQUENCE master_data_item_id_seq;
  CREATE TABLE master_data (
    item_id TEXT PRIMARY KEY DEFAULT ('LAB-' || lpad(nextval('master_data_item_id_seq')::text, 6, '0')),
    barcode TEXT,
    name TEXT NOT NULL,
    reagent_type TEXT CONSTRAINT fk_reagent_type REFERENCES reagent_types (name) ON UPDATE CASCADE,
    job_type TEXT CONSTRAINT fk_job_type REFERENCES job_types (name) ON UPDATE CASCADE,
    machine_type TEXT CONSTRAINT fk_machine_type REFERENCES machine_types (name) ON UPDATE CASCADE,
    unit TEXT,
    min_threshold INTEGER DEFAULT 0,
    weekly_target INTEGER DEFAULT 0,
    vendor TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    vendor_id INTEGER CONSTRAINT master_data_vendor_id_fkey REFERENCES vendors (id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    status_reason TEXT,
    status_changed_at TIMESTAMPTZ,
    status_changed_by TEXT,
    min_shelf_life_days INTEGER CONSTRAINT master_data_min_shelf_life_days_check CHECK (min_shelf_life_days IS NULL OR (min_shelf_life_days >= 0 AND min_shelf_life_days <= 3650))
  );
  CREATE INDEX idx_master_barcode ON master_data (barcode);
  CREATE INDEX idx_master_data_vendor_item_id ON master_data (vendor, item_id);
  CREATE INDEX idx_master_data_is_active ON master_data (is_active, item_id);

  CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    item_id TEXT CONSTRAINT inventory_item_id_fkey REFERENCES master_data (item_id) ON DELETE CASCADE,
    lot_no TEXT NOT NULL,
    exp_date DATE,
    quantity NUMERIC NOT NULL DEFAULT 0 CONSTRAINT check_positive_qty CHECK (quantity >= 0),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    received_on DATE NOT NULL DEFAULT CURRENT_DATE,
    CONSTRAINT inventory_item_id_lot_no_received_on_key UNIQUE (item_id, lot_no, received_on)
  );
  CREATE INDEX idx_inventory_item ON inventory (item_id);
  CREATE INDEX idx_inventory_item_received_on ON inventory (item_id, received_on DESC);
  CREATE INDEX idx_inventory_item_quantity ON inventory (item_id, quantity);
  CREATE INDEX idx_inventory_exp_date ON inventory (exp_date);

  CREATE TABLE logs (
    id SERIAL PRIMARY KEY,
    "timestamp" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    item_id TEXT,
    name TEXT,
    lot_no TEXT,
    action TEXT NOT NULL,
    quantity NUMERIC,
    username TEXT,
    user_agent TEXT,
    ip_address TEXT
  );
  CREATE INDEX idx_logs_timestamp ON logs ("timestamp" DESC);
  CREATE INDEX idx_logs_item ON logs (item_id);

  CREATE TABLE vendor_item_aliases (
    id SERIAL PRIMARY KEY,
    vendor TEXT NOT NULL,
    item_id TEXT NOT NULL CONSTRAINT vendor_item_aliases_item_id_fkey REFERENCES master_data (item_id),
    alias TEXT NOT NULL,
    confirmed_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vendor_item_aliases_vendor_item_id_alias_key UNIQUE (vendor, item_id, alias)
  );
  CREATE INDEX idx_vendor_item_aliases_lookup ON vendor_item_aliases (vendor, item_id);

  CREATE TABLE purchase_orders (
    id SERIAL PRIMARY KEY,
    po_number TEXT NOT NULL UNIQUE,
    vendor TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    note TEXT,
    vendor_note TEXT,
    expected_date DATE,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMPTZ,
    shipped_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    proposal_origin TEXT NOT NULL DEFAULT 'LAB',
    review_requested_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    liff_request_id TEXT,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,
    vendor_response_due_at TIMESTAMPTZ,
    revision_reason TEXT,
    issuer_name TEXT,
    issuer_department TEXT,
    issuer_address TEXT,
    issuer_phone TEXT,
    issuer_email TEXT,
    issuer_logo_url TEXT
  );
  CREATE UNIQUE INDEX idx_purchase_orders_liff_request_id_unique ON purchase_orders (liff_request_id) WHERE liff_request_id IS NOT NULL;
  CREATE INDEX idx_purchase_orders_vendor_status ON purchase_orders (vendor, status, created_at DESC);
  CREATE INDEX idx_purchase_orders_vendor_created_at ON purchase_orders (vendor, created_at DESC);
  CREATE INDEX idx_purchase_orders_acknowledged_at ON purchase_orders (acknowledged_at);

  CREATE TABLE purchase_order_events (
    id BIGSERIAL PRIMARY KEY,
    po_id BIGINT,
    po_number TEXT NOT NULL,
    shipment_id BIGINT,
    event_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE shipment_batches (
    id SERIAL PRIMARY KEY,
    po_number TEXT NOT NULL CONSTRAINT shipment_batches_po_number_fkey REFERENCES purchase_orders (po_number),
    vendor TEXT NOT NULL,
    reference_no TEXT NOT NULL,
    delivery_date DATE,
    tracking_no TEXT,
    tracking_provider TEXT,
    source_type TEXT NOT NULL DEFAULT 'MANUAL',
    source_file_name TEXT,
    source_file_hash TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_request_id TEXT,
    request_fingerprint TEXT
  );
  CREATE INDEX idx_shipment_batches_po ON shipment_batches (po_number, created_at DESC);
  CREATE UNIQUE INDEX uq_shipment_batches_vendor_client_request ON shipment_batches (vendor, client_request_id) WHERE client_request_id IS NOT NULL;
  CREATE UNIQUE INDEX uq_shipment_batches_vendor_request_fingerprint ON shipment_batches (vendor, request_fingerprint) WHERE request_fingerprint IS NOT NULL;

  CREATE TABLE shipments (
    id SERIAL PRIMARY KEY,
    reference_no TEXT,
    vendor TEXT NOT NULL,
    item_id TEXT NOT NULL CONSTRAINT shipments_item_id_fkey REFERENCES master_data (item_id),
    lot_no TEXT NOT NULL,
    exp_date DATE,
    quantity NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'In Transit',
    created_at TIMESTAMPTZ DEFAULT now(),
    received_at TIMESTAMPTZ,
    received_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    po_number TEXT CONSTRAINT shipments_po_number_fkey REFERENCES purchase_orders (po_number),
    tracking_no TEXT,
    tracking_provider TEXT,
    tracking_status TEXT,
    tracking_updated_at TIMESTAMPTZ,
    shipment_batch_id INTEGER CONSTRAINT shipments_shipment_batch_id_fkey REFERENCES shipment_batches (id),
    mapping_confidence TEXT,
    mapping_provenance TEXT,
    accepted_qty NUMERIC,
    rejected_qty NUMERIC NOT NULL DEFAULT 0,
    rejection_reason TEXT,
    shelf_life_override_reason TEXT
  );
  CREATE INDEX idx_shipments_vendor ON shipments (vendor);
  CREATE INDEX idx_shipments_status ON shipments (status);
  CREATE INDEX idx_shipments_tracking_no ON shipments (tracking_no);

  CREATE TABLE count_sessions (
    id BIGSERIAL PRIMARY KEY,
    owner_username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CONSTRAINT count_sessions_status_check CHECK (status = ANY (ARRAY['DRAFT','COMPLETED'])),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX idx_count_sessions_one_draft_per_owner ON count_sessions (lower(owner_username)) WHERE status = 'DRAFT';

  CREATE TABLE count_work_orders (
    id BIGSERIAL PRIMARY KEY,
    owner_username TEXT NOT NULL,
    job_type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'OPEN' CONSTRAINT count_work_orders_status_check CHECK (status = ANY (ARRAY['OPEN','CONFIRMED','CANCELLED'])),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by TEXT
  );
  CREATE UNIQUE INDEX idx_count_work_orders_one_open_per_owner_job ON count_work_orders (lower(owner_username), job_type) WHERE status = 'OPEN';

  CREATE TABLE reagent_loans (
    id BIGSERIAL PRIMARY KEY,
    direction TEXT NOT NULL CONSTRAINT reagent_loans_direction_check CHECK (direction = ANY (ARRAY['BORROWED_IN','LENT_OUT'])),
    partner_name TEXT NOT NULL,
    item_id TEXT NOT NULL CONSTRAINT reagent_loans_item_id_fkey REFERENCES master_data (item_id),
    item_name TEXT NOT NULL,
    lot_no TEXT NOT NULL,
    exp_date DATE,
    quantity NUMERIC NOT NULL CONSTRAINT reagent_loans_quantity_check CHECK (quantity > 0),
    returned_qty NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN' CONSTRAINT reagent_loans_status_check CHECK (status = ANY (ARRAY['OPEN','CLOSED'])),
    loaned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    returned_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    updated_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reagent_loans_check CHECK (returned_qty >= 0 AND returned_qty <= quantity)
  );
  CREATE INDEX reagent_loans_open_direction_idx ON reagent_loans (direction, status, loaned_at DESC);
  CREATE INDEX reagent_loans_partner_idx ON reagent_loans (partner_name, status);

  CREATE TABLE barcode_pattern_v2 (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CONSTRAINT barcode_pattern_v2_status_check CHECK (status = ANY (ARRAY['DRAFT','VERIFIED','ACTIVE','INACTIVE'])),
    mapping_mode TEXT NOT NULL CONSTRAINT barcode_pattern_v2_mapping_mode_check CHECK (mapping_mode = ANY (ARRAY['CAPTURED_IDENTIFIER','FIXED_REAGENT'])),
    fixed_item_id TEXT CONSTRAINT barcode_pattern_v2_fixed_item_id_fkey REFERENCES master_data (item_id),
    regex_pattern TEXT NOT NULL,
    item_id_group INTEGER,
    lot_no_group INTEGER,
    exp_date_group INTEGER,
    examples JSONB NOT NULL DEFAULT '[]'::jsonb,
    verification JSONB NOT NULL DEFAULT '{"errors": [], "status": "UNVERIFIED"}'::jsonb,
    created_by TEXT CONSTRAINT barcode_pattern_v2_created_by_fkey REFERENCES users (username),
    updated_by TEXT CONSTRAINT barcode_pattern_v2_updated_by_fkey REFERENCES users (username),
    activated_by TEXT CONSTRAINT barcode_pattern_v2_activated_by_fkey REFERENCES users (username),
    deactivated_by TEXT CONSTRAINT barcode_pattern_v2_deactivated_by_fkey REFERENCES users (username),
    deactivation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    CONSTRAINT barcode_pattern_v2_mapping_check CHECK ((mapping_mode = 'FIXED_REAGENT' AND fixed_item_id IS NOT NULL) OR (mapping_mode = 'CAPTURED_IDENTIFIER' AND fixed_item_id IS NULL)),
    CONSTRAINT barcode_pattern_v2_groups_check CHECK (COALESCE(item_id_group, 0) >= 0 AND COALESCE(lot_no_group, 0) >= 0 AND COALESCE(exp_date_group, 0) >= 0)
  );
  CREATE INDEX idx_barcode_pattern_v2_runtime ON barcode_pattern_v2 (status, created_at DESC);
  CREATE UNIQUE INDEX uq_barcode_pattern_v2_active_regex ON barcode_pattern_v2 (regex_pattern) WHERE status = 'ACTIVE';

  CREATE TABLE barcode_patterns (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    regex_pattern TEXT NOT NULL,
    item_id_group INTEGER,
    lot_no_group INTEGER,
    exp_date_group INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT CONSTRAINT notification_outbox_event_id_fkey REFERENCES purchase_order_events (id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    po_id BIGINT,
    shipment_id BIGINT,
    recipient_username TEXT NOT NULL,
    recipient_role TEXT NOT NULL,
    channel TEXT NOT NULL CONSTRAINT notification_outbox_channel_check CHECK (channel = ANY (ARRAY['LINE','EMAIL'])),
    recipient_address TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'PENDING' CONSTRAINT notification_outbox_status_check CHECK (status = ANY (ARRAY['PENDING','PROCESSING','DELIVERED','DEAD','SKIPPED'])),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    last_error TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_notification_outbox_ready ON notification_outbox (status, next_attempt_at, id);
  CREATE INDEX idx_notification_outbox_po ON notification_outbox (po_id, created_at DESC);

  CREATE TABLE lab_profile (
    id SMALLINT PRIMARY KEY DEFAULT 1 CONSTRAINT lab_profile_id_check CHECK (id = 1),
    organization_name TEXT NOT NULL DEFAULT 'LabStock',
    department_name TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    logo_url TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE app_events (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_id TEXT,
    username TEXT,
    role TEXT,
    action TEXT NOT NULL,
    route TEXT NOT NULL,
    method TEXT,
    outcome TEXT NOT NULL CONSTRAINT app_events_outcome_check CHECK (outcome = ANY (ARRAY['success','rejected','error'])),
    status INTEGER,
    message TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    duration_ms INTEGER
  );
  CREATE INDEX idx_app_events_user_time ON app_events (lower(username), created_at DESC);
  CREATE INDEX idx_app_events_time ON app_events (created_at DESC);
  CREATE INDEX idx_app_events_failures ON app_events (action, created_at DESC) WHERE outcome <> 'success';
`;

/** A few rows per table, all valid under the production constraints. */
export const PROD_SEED_SQL = `
  SELECT setval('master_data_item_id_seq', 100);
  INSERT INTO departments (id, name) VALUES (1, 'ห้องปฏิบัติการเคมีคลินิก'), (2, 'งานอณูชีววิทยา');
  SELECT setval(pg_get_serial_sequence('departments', 'id'), 2);
  INSERT INTO users (username, password_hash, name, role) VALUES
    ('admin1', 'x', 'Admin One', 'Admin'),
    ('user1', 'x', 'User One', 'User'),
    ('vendor1', 'x', 'Vendor One', 'Vendor');
  INSERT INTO reagent_types (name) VALUES ('Chemistry'), ('Immuno');
  INSERT INTO job_types (name) VALUES ('Routine');
  INSERT INTO machine_types (name) VALUES ('AU5800');
  INSERT INTO vendors (name) VALUES ('Vendor A'), ('Vendor B');
  INSERT INTO master_data (item_id, name, unit, vendor, reagent_type, job_type, machine_type) VALUES
    ('LAB-000001', 'Reagent 1', 'box', 'Vendor A', 'Chemistry', 'Routine', 'AU5800'),
    ('LAB-000002', 'Reagent 2', 'box', 'Vendor B', 'Immuno', NULL, NULL),
    ('X-LEGACY', 'Reagent 3', 'kit', 'Vendor A', NULL, NULL, NULL);
  INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on) VALUES
    ('LAB-000001', 'L1', '2027-01-01', 5, '2026-09-01'),
    ('LAB-000001', 'L2', '2027-02-01', 3, '2026-09-02'),
    ('LAB-000002', 'L9', '2027-03-01', 7, '2026-09-03');
  INSERT INTO logs (item_id, name, lot_no, action, quantity, username) VALUES
    ('LAB-000001', 'Reagent 1', 'L1', 'RECEIVE', 5, 'user1'),
    ('LAB-000002', 'Reagent 2', 'L9', 'RECEIVE', 7, 'user1');
  INSERT INTO vendor_item_aliases (vendor, item_id, alias, confirmed_by) VALUES
    ('Vendor A', 'LAB-000001', 'R1-ALIAS', 'admin1');
  INSERT INTO purchase_orders (po_number, vendor, created_by, status) VALUES
    ('PO-20260901-001', 'Vendor A', 'user1', 'CONFIRMED'),
    ('PO-20260901-002', 'Vendor B', 'user1', 'DRAFT');
  INSERT INTO shipment_batches (po_number, vendor, reference_no, created_by, client_request_id, request_fingerprint) VALUES
    ('PO-20260901-001', 'Vendor A', 'REF-1', 'vendor1', 'req-1', 'fp-1'),
    ('PO-20260901-001', 'Vendor A', 'REF-2', 'vendor1', NULL, NULL);
  INSERT INTO shipments (vendor, item_id, lot_no, quantity, po_number, shipment_batch_id) VALUES
    ('Vendor A', 'LAB-000001', 'L1', 5, 'PO-20260901-001', 1);
  INSERT INTO purchase_order_events (po_id, po_number, event_type) VALUES (1, 'PO-20260901-001', 'CREATED');
  INSERT INTO notification_outbox (event_id, event_type, po_id, recipient_username, recipient_role, channel, recipient_address, idempotency_key) VALUES
    (1, 'PO_CONFIRMED', 1, 'vendor1', 'Vendor', 'LINE', 'U123', 'idem-1');
  INSERT INTO count_sessions (owner_username, status) VALUES ('user1', 'DRAFT'), ('user1', 'COMPLETED');
  INSERT INTO count_work_orders (owner_username, job_type, status) VALUES ('user1', 'Routine', 'OPEN'), ('user1', 'Routine', 'CONFIRMED');
  INSERT INTO reagent_loans (direction, partner_name, item_id, item_name, lot_no, quantity, created_by) VALUES
    ('LENT_OUT', 'Hospital X', 'LAB-000001', 'Reagent 1', 'L1', 2, 'user1');
  INSERT INTO barcode_pattern_v2 (name, status, mapping_mode, regex_pattern, created_by) VALUES
    ('Pattern A', 'ACTIVE', 'CAPTURED_IDENTIFIER', '^A(\\d+)$', 'admin1'),
    ('Pattern B', 'DRAFT', 'CAPTURED_IDENTIFIER', '^A(\\d+)$', 'admin1');
  INSERT INTO barcode_patterns (name, regex_pattern) VALUES ('Legacy', '^L(\\d+)$');
  INSERT INTO lab_profile (id, organization_name) VALUES (1, 'LabStock');
  INSERT INTO app_events (action, route, outcome) VALUES ('login', '/api/auth', 'success'), ('stock', '/api/stock', 'error');
`;
