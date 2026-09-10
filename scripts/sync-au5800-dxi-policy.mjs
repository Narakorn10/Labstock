import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

// Authoritative source: OneDrive/เอกสาร/บริหารสั่งน้ำยา.xlsx, Reagent (3), rows 4-57.
// monthly_qty = "สรุปใช้ต่อเดือน"; order_qty = "จน.สั่งต่อเดือน" (quantity per order);
// orders_per_month is 2 only where the worksheet explicitly says "สั่ง 2 ครั้ง/เดือน".
const policyRows = [
  ["CHEM-R-001", 15, 15, 1], ["CHEM-R-002", 25, 25, 1], ["CHEM-R-003", 68, 35, 2],
  ["CHEM-R-004", 4, 4, 1], ["CHEM-R-005", 10, 10, 1], ["CHEM-R-006", 10, 10, 1],
  ["CHEM-R-007", 18, 9, 2], ["CHEM-R-008", 3, 3, 1], ["CHEM-R-009", 10, 10, 1],
  ["CHEM-R-010", 10, 10, 1], ["CHEM-R-011", 12, 12, 1], ["CHEM-R-012", 12, 12, 1],
  ["CHEM-R-013", 15, 15, 1], ["CHEM-R-014", 12, 12, 1], ["CHEM-R-015", 30, 15, 2],
  ["CHEM-R-016", 25, 15, 1], ["CHEM-R-017", 6, 3, 2], ["CHEM-R-018", 8, 8, 1],
  ["CHEM-R-019", 15, 7, 2], ["CHEM-R-020", 2, 2, 1], ["CHEM-R-021", 2, 2, 1],
  ["CHEM-R-022", 2, 2, 1], ["CHEM-R-023", 5, 5, 1], ["CHEM-R-024", 1, 1, 1],
  ["CHEM-R-025", 1, 1, 1], ["CHEM-R-026", 6, 6, 1], ["CHEM-R-027", 24, 12, 2],
  ["CHEM-R-028", 10, 10, 1], ["CHEM-R-029", 1, 1, 1], ["CHEM-R-030", 1, 1, 1],
  ["CHEM-R-031", 2, 2, 1], ["IM-R-001", 15, 8, 2], ["IM-R-002", 18, 9, 2],
  ["IM-R-003", 10, 5, 2], ["IM-R-004", 0, 0, 1], ["IM-R-005", 0, 0, 1],
  ["IM-R-006", 6, 3, 2], ["IM-R-007", 1, 1, 1], ["IM-R-008", 2, 2, 1],
  ["IM-R-009", 6, 3, 2], ["IM-R-010", 1, 1, 1], ["IM-R-011", 3, 3, 1],
  ["IM-R-012", 1, 1, 1], ["IM-R-013", 1, 1, 1], ["IM-R-014", 5, 5, 1],
  ["IM-R-015", 1, 1, 1], ["IM-R-016", 1, 1, 1], ["IM-R-017", 1, 1, 1],
  ["IM-R-018", 12, 6, 2], ["CHEM-R-032", 1, 1, 1], ["CHEM-R-033", 1, 1, 1],
].map(([item_id, approved_monthly_target_boxes, approved_order_qty_boxes, orders_per_month]) => ({
  item_id, approved_monthly_target_boxes, approved_order_qty_boxes, orders_per_month,
}));

const sql = neon(process.env.DATABASE_URL);
const result = await sql`
  WITH incoming AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(policyRows)}::jsonb)
      AS input(item_id TEXT, approved_monthly_target_boxes NUMERIC, approved_order_qty_boxes NUMERIC, orders_per_month NUMERIC)
  ), guard AS (
    SELECT (SELECT count(*) FROM incoming) AS source_rows,
      (SELECT count(*) FROM reagent_order_policy p JOIN incoming input ON input.item_id = p.item_id) AS matched_rows
  ), before_state AS (
    SELECT p.*, input.approved_monthly_target_boxes AS next_monthly,
      input.approved_order_qty_boxes AS next_order, input.orders_per_month AS next_frequency
    FROM reagent_order_policy p JOIN incoming input ON input.item_id = p.item_id
  ), updated AS (
    UPDATE reagent_order_policy p
    SET approved_monthly_target_boxes = before_state.next_monthly,
      approved_order_qty_boxes = before_state.next_order,
      orders_per_month = before_state.next_frequency,
      lead_time_days = 5,
      source_verification_status = 'VERIFIED',
      revision = p.revision + 1,
      reason = 'Synced from บริหารสั่งน้ำยา.xlsx / Reagent (3)', updated_at = NOW()
    FROM before_state
    CROSS JOIN guard
    WHERE p.item_id = before_state.item_id
      AND guard.matched_rows = guard.source_rows
      AND (p.approved_monthly_target_boxes, p.approved_order_qty_boxes, p.orders_per_month, p.lead_time_days, p.source_verification_status)
        IS DISTINCT FROM (before_state.next_monthly, before_state.next_order, before_state.next_frequency, 5, 'VERIFIED')
    RETURNING p.item_id, p.revision, to_jsonb(before_state) AS before_state, to_jsonb(p) AS after_state
  ), history AS (
    INSERT INTO reagent_order_policy_history (item_id, revision, before_state, after_state, changed_by, reason)
    SELECT item_id, revision, before_state, after_state, 'system-policy-sync', 'Synced from บริหารสั่งน้ำยา.xlsx / Reagent (3)'
    FROM updated
  )
  SELECT (SELECT source_rows FROM guard) AS source_rows,
    (SELECT matched_rows FROM guard) AS matched_rows,
    (SELECT count(*) FROM updated) AS updated_rows
`;

if (Number(result[0].matched_rows) !== policyRows.length) {
  throw new Error(`Expected ${policyRows.length} policy matches but found ${result[0].matched_rows}; no changes were committed.`);
}
console.log(JSON.stringify(result[0]));
