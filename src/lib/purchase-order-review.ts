import type sqlClient from "./db";

type Sql = typeof sqlClient;
type Query = ReturnType<Sql>;

export const PO_STATE_CHANGED = "PO_STATE_CHANGED";

/** First statement of a PO transaction: locks the order and aborts if its status moved on. */
export function assertPurchaseOrderStatusQuery(sql: Sql, poId: number, expectedStatus: string) {
  return sql`
    SELECT labstock_assert(EXISTS (
      SELECT 1 FROM purchase_orders WHERE id = ${poId} AND status = ${expectedStatus} FOR UPDATE
    ), ${PO_STATE_CHANGED}) AS ok
  `;
}

export function isPurchaseOrderStateChangedError(error: unknown) {
  return error instanceof Error && error.message.includes(PO_STATE_CHANGED);
}

/**
 * Runs `queries` after locking the PO at `expectedStatus`, all in one transaction.
 * Returns null (nothing written) when another request changed the PO first.
 */
export async function runGuardedPurchaseOrderUpdate(sql: Sql, poId: number, expectedStatus: string, queries: Query[]) {
  try {
    const [, ...results] = await sql.transaction([assertPurchaseOrderStatusQuery(sql, poId, expectedStatus), ...queries]);
    return results;
  } catch (error) {
    if (isPurchaseOrderStateChangedError(error)) return null;
    throw error;
  }
}

/**
 * Lab decision on an order awaiting Lab review (a Vendor proposal or a Vendor revision).
 * Approving a revision applies the Vendor's revised quantities; either decision clears them.
 * Returns false when the order was already reviewed or changed.
 */
export async function applyLabReviewDecision(sql: Sql, input: {
  po: { id: number; status: string; confirmed_at?: unknown };
  decision: "CONFIRMED" | "REJECTED";
  reviewer: string;
}) {
  const { po, decision, reviewer } = input;
  const queries: Query[] = [sql`
    UPDATE purchase_orders
    SET status = ${decision}, reviewed_at = NOW(), reviewed_by = ${reviewer},
        confirmed_at = ${decision === "CONFIRMED" ? new Date().toISOString() : po.confirmed_at ?? null},
        updated_at = NOW()
    WHERE id = ${po.id}
  `];
  if (po.status === "REVISION_REQUESTED") {
    queries.push(decision === "CONFIRMED"
      ? sql`UPDATE purchase_order_items SET quantity = COALESCE(revision_qty, quantity), revision_qty = NULL, revision_reason = NULL WHERE po_id = ${po.id}`
      : sql`UPDATE purchase_order_items SET revision_qty = NULL, revision_reason = NULL WHERE po_id = ${po.id}`);
  }
  return (await runGuardedPurchaseOrderUpdate(sql, po.id, po.status, queries)) !== null;
}
