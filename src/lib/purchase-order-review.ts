import type sqlClient from "./db";
import { andDeptWrite, writeDepartmentId, type DepartmentScope } from "./scoped-db";
import { CANCELLABLE_STATUSES, CLOSE_SHORT_STATUSES } from "./purchase-order-workflow";

type Sql = typeof sqlClient;
type Query = ReturnType<Sql>;

export const PO_STATE_CHANGED = "PO_STATE_CHANGED";

// REQUIRED scope. The runtime check guards the slot against a wrong argument (a user object, a number, undefined...):
// andDeptWrite() treats legacy as "no filter", so a malformed scope must never reach it. Shared by the PO write helpers.
export function assertPurchaseOrderScope(scope: DepartmentScope | undefined, caller: string): asserts scope is DepartmentScope {
  const mode = (scope as { mode?: unknown } | undefined)?.mode;
  const valid = mode === "legacy" || mode === "all" || (mode === "one" && Number.isInteger((scope as { departmentId?: unknown }).departmentId));
  if (!valid) throw new Error(`${caller} requires a DepartmentScope`);
}

/**
 * First statement of a PO transaction: locks the order and aborts if its status moved on.
 * This is the department lock point: the PO must belong to `scope` (mode "all" throws DEPARTMENT_READ_ONLY), otherwise the
 * assert fails and the whole transaction rolls back. The later UPDATEs do not repeat the filter.
 */
export function assertPurchaseOrderStatusQuery(sql: Sql, poId: number, expectedStatus: string, scope: DepartmentScope) {
  assertPurchaseOrderScope(scope, "assertPurchaseOrderStatusQuery");
  return sql`
    SELECT labstock_assert(EXISTS (
      SELECT 1 FROM purchase_orders WHERE id = ${poId} AND status = ${expectedStatus}${andDeptWrite(scope)} FOR UPDATE
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
export async function runGuardedPurchaseOrderUpdate(sql: Sql, poId: number, expectedStatus: string, queries: Query[], scope: DepartmentScope) {
  assertPurchaseOrderScope(scope, "runGuardedPurchaseOrderUpdate"); // before any SQL
  const lock = assertPurchaseOrderStatusQuery(sql, poId, expectedStatus, scope); // mode "all" throws here, outside the try
  try {
    const [, ...results] = await sql.transaction([lock, ...queries]);
    return results;
  } catch (error) {
    if (isPurchaseOrderStateChangedError(error)) return null;
    throw error;
  }
}

export const PO_HAS_IN_TRANSIT = "PO_HAS_IN_TRANSIT";

type ClosureResult = { ok: true; status: "CANCELLED" | "CLOSED_SHORT" } | { ok: false; httpStatus: number; error: string };

/**
 * Lab ends an open order: CANCEL before anything was received, or CLOSE_SHORT after a
 * partial receipt. Both require a reason and no shipment still in transit. The remaining
 * quantity then stops counting as on-order, because neither status is in the open lists.
 */
export async function closePurchaseOrder(sql: Sql, input: {
  po: { id: number; po_number: string; status: string };
  action: "CANCEL" | "CLOSE_SHORT";
  reason: string;
  scope: DepartmentScope;
}): Promise<ClosureResult> {
  const { po, action, reason, scope } = input;
  assertPurchaseOrderScope(scope, "closePurchaseOrder"); // before any SQL
  writeDepartmentId(scope); // mode "all" -> DEPARTMENT_READ_ONLY before anything else
  if (!reason.trim()) return { ok: false, httpStatus: 400, error: "Please provide a reason for closing this purchase order" };

  const allowed = action === "CANCEL" ? CANCELLABLE_STATUSES : CLOSE_SHORT_STATUSES;
  if (!allowed.includes(po.status)) {
    return {
      ok: false,
      httpStatus: 409,
      error: action === "CANCEL"
        ? "Only an order sent to the Vendor with nothing received can be cancelled"
        : "Only a partially received order can be closed short",
    };
  }

  const nextStatus = action === "CANCEL" ? "CANCELLED" : "CLOSED_SHORT";
  try {
    const result = await runGuardedPurchaseOrderUpdate(sql, po.id, po.status, [
      // Intentionally NOT filtered by department: po_number is globally unique and a shipment can be stamped with another
      // department than its PO (vendor/shipments POST still writes the default department until it is migrated), so an
      // in-transit shipment must block closing whatever its stamp.
      sql`
        SELECT labstock_assert(NOT EXISTS (
          SELECT 1 FROM shipments WHERE po_number = ${po.po_number} AND status = 'In Transit'
        ), ${PO_HAS_IN_TRANSIT}) AS ok
      `,
      sql`UPDATE purchase_orders SET status = ${nextStatus}, updated_at = NOW() WHERE id = ${po.id}`,
      sql`UPDATE purchase_order_items SET revision_qty = NULL, revision_reason = NULL WHERE po_id = ${po.id}`,
    ], scope);
    if (!result) return { ok: false, httpStatus: 409, error: "This order changed before it could be closed" };
  } catch (error) {
    if (error instanceof Error && error.message.includes(PO_HAS_IN_TRANSIT)) {
      return { ok: false, httpStatus: 409, error: "Receive or cancel the in-transit shipments before closing this order" };
    }
    throw error;
  }
  return { ok: true, status: nextStatus };
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
  scope: DepartmentScope;
}) {
  const { po, decision, reviewer, scope } = input;
  assertPurchaseOrderScope(scope, "applyLabReviewDecision"); // before any SQL
  writeDepartmentId(scope); // mode "all" -> DEPARTMENT_READ_ONLY before anything else
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
  return (await runGuardedPurchaseOrderUpdate(sql, po.id, po.status, queries, scope)) !== null;
}
