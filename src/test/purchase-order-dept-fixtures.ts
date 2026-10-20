import type { PgliteSql } from "@/test/pglite-sql";

// Shared by the purchase-order department tests (G5 PR-2). They run on seedTwoDepartments (production schema + v30-v35);
// this adds the pieces that fixture does not have: the labstock_assert helper, purchase_order_items and the order policy.

export async function addPurchaseOrderTables(sql: PgliteSql) {
  await sql.db.exec(`
    CREATE FUNCTION labstock_assert(condition BOOLEAN, error_message TEXT) RETURNS BOOLEAN AS $$
    BEGIN
      IF condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%', error_message; END IF;
      RETURN TRUE;
    END;
    $$ LANGUAGE plpgsql;
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
  `);
}

/** Inserts one PO with one line and returns ids. quantity is the ordered quantity; accepted/received start at 0 unless given. */
export async function insertPurchaseOrder(sql: PgliteSql, input: {
  poNumber: string;
  departmentId: number;
  status: string;
  vendor?: string;
  itemId?: string;
  quantity?: number;
  acceptedQty?: number;
  proposalOrigin?: string;
}) {
  const po = await sql.db.query<{ id: number }>(
    `INSERT INTO purchase_orders (po_number, vendor, created_by, status, proposal_origin, department_id)
     VALUES ($1, $2, 'seed', $3, $4, $5) RETURNING id`,
    [input.poNumber, input.vendor ?? "Vendor A", input.status, input.proposalOrigin ?? "LAB", input.departmentId],
  );
  const poId = po.rows[0].id;
  const item = await sql.db.query<{ id: number }>(
    `INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit, received_qty, accepted_qty)
     VALUES ($1, $2, 'seed item', $3, 'box', $4, $4) RETURNING id`,
    [poId, input.itemId ?? "A-000002", input.quantity ?? 10, input.acceptedQty ?? 0],
  );
  return { poId, itemRowId: item.rows[0].id };
}

/** Records the text of every statement a helper issues (tagged calls and transaction members). Forwards to the real db. */
export function recordingSql(db: PgliteSql, seen: string[]) {
  return Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = db(strings, ...values);
      seen.push(query.text);
      return query;
    },
    {
      unsafe: (text: string) => db.unsafe(text),
      transaction: (queries: Array<{ text: string }>) => {
        seen.push(...queries.map((query) => query.text));
        return db.transaction(queries as never);
      },
    },
  );
}
