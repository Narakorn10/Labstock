import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const sql = neon(process.env.DATABASE_URL);

const statements = [
  sql`
    ALTER TABLE reagent_order_policy
      ADD COLUMN IF NOT EXISTS documented_actual_withdrawal_boxes NUMERIC
        CHECK (documented_actual_withdrawal_boxes IS NULL OR documented_actual_withdrawal_boxes >= 0),
      ADD COLUMN IF NOT EXISTS source_verification_status TEXT NOT NULL DEFAULT 'NOT_AVAILABLE'
        CHECK (source_verification_status IN ('VERIFIED', 'NEEDS_REVIEW', 'NOT_AVAILABLE')),
      ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1
        CHECK (revision > 0)
  `,
  sql`ALTER TABLE reagent_order_policy ALTER COLUMN orders_per_month SET DEFAULT 2`,
  sql`
    CREATE TABLE IF NOT EXISTS reagent_order_policy_history (
      id BIGSERIAL PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES reagent_order_policy(item_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK (revision > 0),
      before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      after_state JSONB NOT NULL,
      changed_by TEXT,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reason TEXT
    )
  `,
  sql`CREATE INDEX IF NOT EXISTS idx_reagent_order_policy_history_item_changed ON reagent_order_policy_history (item_id, changed_at DESC)`,
  sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS selected_basis TEXT NOT NULL DEFAULT 'POLICY'`,
  sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'purchase_order_items_selected_basis_check'
          AND conrelid = 'purchase_order_items'::regclass
      ) THEN
        ALTER TABLE purchase_order_items
          ADD CONSTRAINT purchase_order_items_selected_basis_check
          CHECK (selected_basis IN ('POLICY', 'DYNAMIC', 'MANUAL'));
      END IF;
    END $$
  `,
  sql`UPDATE reagent_order_policy SET orders_per_month = 2 WHERE orders_per_month IS DISTINCT FROM 2`,
  sql`
    UPDATE reagent_order_policy policy
    SET source_verification_status = 'NEEDS_REVIEW',
        reason = CASE
          WHEN COALESCE(policy.reason, '') ILIKE '%Urine/CSF Protein source needs review%'
            THEN policy.reason
          ELSE CONCAT_WS(' ', NULLIF(policy.reason, ''), 'Urine/CSF Protein source needs review; approved quantities retained.')
        END,
        updated_at = NOW()
    FROM master_data item
    WHERE item.item_id = policy.item_id
      AND (UPPER(item.name) LIKE '%URINE%PROTEIN%' OR UPPER(item.name) LIKE '%CSF%PROTEIN%')
  `,
  sql`
    INSERT INTO reagent_order_policy (
      item_id, orders_per_month, enabled, source_verification_status, reason, created_at, updated_at
    )
    SELECT item.item_id, 2, true, 'NOT_AVAILABLE',
      'ISE consumable policy created for two cycles per month; quantity awaits Admin approval.', NOW(), NOW()
    FROM master_data item
    WHERE UPPER(REGEXP_REPLACE(BTRIM(item.name), '\\s+', ' ', 'g')) IN ('ISE BUFFER', 'ISE REFERENCE', 'ISE MID STANDARD')
    ON CONFLICT (item_id) DO UPDATE
    SET orders_per_month = 2,
        reason = CASE
          WHEN COALESCE(reagent_order_policy.reason, '') ILIKE '%ISE consumable policy created for two cycles per month%'
            THEN reagent_order_policy.reason
          ELSE CONCAT_WS(' ', NULLIF(reagent_order_policy.reason, ''), 'ISE consumable policy created for two cycles per month; quantity awaits Admin approval.')
        END,
        updated_at = NOW()
    WHERE reagent_order_policy.orders_per_month IS DISTINCT FROM 2
       OR COALESCE(reagent_order_policy.reason, '') NOT ILIKE '%ISE consumable policy created for two cycles per month%'
  `,
];

await sql.transaction(statements);
console.log("Applied reagent-order suggestion v17 successfully.");
