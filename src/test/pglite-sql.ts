import { PGlite } from "@electric-sql/pglite";

// Test-only stand-in for the Neon `sql` client, backed by a real in-memory
// Postgres (PGlite). Unit tests that mock `sql` cannot catch SQL semantics such
// as data-modifying CTEs not seeing each other's writes; these tests can.

const QUERY = Symbol("pglite-query");

type Row = Record<string, unknown>;

type PgliteQuery = PromiseLike<Row[]> & {
  [QUERY]: true;
  text: string;
  params: unknown[];
};

export type PgliteSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): PgliteQuery;
  transaction: (queries: PgliteQuery[] | ((tx: PgliteSql) => PgliteQuery[])) => Promise<Row[][]>;
  db: PGlite;
};

function isQuery(value: unknown): value is PgliteQuery {
  return typeof value === "object" && value !== null && (value as PgliteQuery)[QUERY] === true;
}

function toParam(value: unknown) {
  // Neon sends Date objects as ISO strings; do the same so timestamps compare the same way.
  return value instanceof Date ? value.toISOString() : value;
}

export function createPgliteSql(db: PGlite = new PGlite()): PgliteSql {
  const run = (text: string, params: unknown[]) => db.query<Row>(text, params).then((result) => result.rows);

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    const params: unknown[] = [];
    values.forEach((value, index) => {
      if (isQuery(value)) {
        // Nested fragment, e.g. sql`SELECT a${flag ? sql`, b` : sql``}`: inline it and renumber its params.
        text += value.text.replace(/\$(\d+)/g, (_, n: string) => `$${params.length + Number(n)}`);
        params.push(...value.params);
      } else {
        params.push(toParam(value));
        text += `$${params.length}`;
      }
      text += strings[index + 1];
    });

    const query = {
      [QUERY]: true as const,
      text,
      params,
      then<TResult1 = Row[], TResult2 = never>(
        onFulfilled?: ((rows: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return run(text, params).then(onFulfilled, onRejected);
      },
    };
    return query;
  }) as unknown as PgliteSql;

  // Like Neon's non-interactive transaction: statements run in order, all or nothing.
  sql.transaction = async (queries) => {
    const list = typeof queries === "function" ? queries(sql) : queries;
    return db.transaction(async (tx) => {
      const results: Row[][] = [];
      for (const query of list) {
        results.push((await tx.query<Row>(query.text, query.params)).rows);
      }
      return results;
    });
  };
  sql.db = db;
  return sql;
}

/** Minimal slice of the production schema used by the purchase-order flow. */
export const PURCHASE_ORDER_TEST_SCHEMA = `
  CREATE FUNCTION labstock_assert(condition BOOLEAN, error_message TEXT) RETURNS BOOLEAN AS $$
  BEGIN
    IF condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%', error_message; END IF;
    RETURN TRUE;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TABLE master_data (
    item_id TEXT PRIMARY KEY, name TEXT, unit TEXT, vendor TEXT, is_active BOOLEAN DEFAULT TRUE,
    reagent_type TEXT, job_type TEXT, machine_type TEXT, barcode TEXT, min_threshold INTEGER, weekly_target INTEGER
  );
  CREATE TABLE inventory (
    id SERIAL PRIMARY KEY, item_id TEXT, lot_no TEXT, exp_date DATE, quantity NUMERIC, received_on DATE,
    UNIQUE (item_id, lot_no, received_on)
  );
  CREATE TABLE logs (
    id SERIAL PRIMARY KEY, timestamp TIMESTAMPTZ DEFAULT NOW(), item_id TEXT, name TEXT, lot_no TEXT, action TEXT,
    quantity NUMERIC, username TEXT, user_agent TEXT, ip_address TEXT
  );
  CREATE TABLE lab_profile (
    id INT PRIMARY KEY, organization_name TEXT, department_name TEXT, address TEXT, phone TEXT, email TEXT, logo_url TEXT
  );
  CREATE TABLE purchase_orders (
    id SERIAL PRIMARY KEY, po_number TEXT UNIQUE NOT NULL, vendor TEXT, note TEXT, expected_date DATE,
    created_by TEXT, status TEXT, proposal_origin TEXT DEFAULT 'LAB', review_requested_at TIMESTAMPTZ,
    liff_request_id TEXT, issuer_name TEXT, issuer_department TEXT, issuer_address TEXT, issuer_phone TEXT,
    issuer_email TEXT, issuer_logo_url TEXT, vendor_note TEXT, acknowledged_at TIMESTAMPTZ, acknowledged_by TEXT,
    vendor_response_due_at TIMESTAMPTZ, revision_reason TEXT, confirmed_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT, shipped_at TIMESTAMPTZ, received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE purchase_order_items (
    id SERIAL PRIMARY KEY, po_id INT REFERENCES purchase_orders(id), item_id TEXT, item_name TEXT, quantity NUMERIC,
    unit TEXT, received_qty NUMERIC, accepted_qty NUMERIC, rejected_qty NUMERIC, revision_qty NUMERIC,
    revision_reason TEXT, acknowledged_qty NUMERIC, available_qty NUMERIC, system_suggested_qty NUMERIC,
    override_reason TEXT, calculation_version TEXT, calculation_snapshot JSONB, selected_basis TEXT,
    reagent_type TEXT, job_type TEXT, machine_type TEXT
  );
  CREATE TABLE reagent_order_policy (
    item_id TEXT PRIMARY KEY, tests_per_box NUMERIC, avg_patient_tests_per_month NUMERIC NOT NULL DEFAULT 0,
    iqc_tests_per_month NUMERIC NOT NULL DEFAULT 0, documented_actual_withdrawal_boxes NUMERIC,
    approved_monthly_target_boxes NUMERIC, approved_order_qty_boxes NUMERIC, orders_per_month NUMERIC NOT NULL DEFAULT 2,
    lead_time_days INTEGER NOT NULL DEFAULT 7, safety_stock_boxes NUMERIC, min_order_qty_boxes INTEGER NOT NULL DEFAULT 1,
    order_multiple_boxes INTEGER NOT NULL DEFAULT 1, review_days INTEGER, enabled BOOLEAN NOT NULL DEFAULT TRUE,
    source_verification_status TEXT NOT NULL DEFAULT 'VERIFIED', revision INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE purchase_order_events (
    id BIGSERIAL PRIMARY KEY, po_id BIGINT, po_number TEXT NOT NULL, shipment_id BIGINT, event_type TEXT NOT NULL,
    from_status TEXT, to_status TEXT, actor_username TEXT, actor_role TEXT, source TEXT NOT NULL DEFAULT 'WEB',
    visibility TEXT NOT NULL DEFAULT 'BOTH', note TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE shipment_batches (
    id SERIAL PRIMARY KEY, po_number TEXT, vendor TEXT, reference_no TEXT, delivery_date DATE, tracking_no TEXT,
    tracking_provider TEXT, source_type TEXT, source_file_name TEXT, source_file_hash TEXT, created_by TEXT,
    client_request_id TEXT, request_fingerprint TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE shipments (
    id SERIAL PRIMARY KEY, shipment_batch_id INT, reference_no TEXT, po_number TEXT, tracking_no TEXT,
    tracking_provider TEXT, vendor TEXT, item_id TEXT, lot_no TEXT, exp_date DATE, quantity NUMERIC, status TEXT,
    mapping_confidence TEXT, mapping_provenance TEXT, received_at TIMESTAMPTZ, received_by TEXT,
    accepted_qty NUMERIC, rejected_qty NUMERIC, rejection_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;
