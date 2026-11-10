import type sqlClient from "./db";
import { assertPurchaseOrderScope, runGuardedPurchaseOrderUpdate } from "./purchase-order-review";
import { writeDepartmentId, type DepartmentScope } from "./scoped-db";

type Sql = typeof sqlClient;

// "Approve and send to the Vendor" only goes through for what the approver was looking at.
//
// A manager may add lines (ADD_ITEMS_TO_MANAGER_REVIEW) or change quantities / the note / the date while an order waits for
// review. If a second manager approves after that without having seen it, the Vendor would get lines nobody approved.
// So the page receives a review token with the order, sends it back with the approval, and the server compares it against
// the order as it is NOW, inside the transaction that has the order row locked. A mismatch changes nothing.
//
// The token is a hash of what the approver sees and decides on: each line (item and quantity), the note and the expected date.

export const PO_REVIEW_CHANGED = "PO_REVIEW_CHANGED";

/** SQL expression (no trailing semicolon) of the review token of order `poId`, read from the database right now. */
function reviewTokenExpression(sql: Sql, poId: number) {
  return sql`(
    SELECT md5(
      COALESCE((SELECT string_agg(poi.item_id || ':' || poi.quantity::text, ',' ORDER BY poi.item_id)
                FROM purchase_order_items poi WHERE poi.po_id = p.id), '')
      || '|' || COALESCE(p.note, '') || '|' || COALESCE(p.expected_date::text, '')
    )
    FROM purchase_orders p WHERE p.id = ${poId}
  )`;
}

export async function getReviewToken(sql: Sql, poId: number): Promise<string | null> {
  const rows = await sql`SELECT ${reviewTokenExpression(sql, poId)} AS token`;
  const token = rows[0]?.token;
  return typeof token === "string" ? token : null;
}

export type ApproveResult = { ok: true } | { ok: false; code: "PO_REVIEW_CHANGED" | "PO_STATE_CHANGED"; error: string };

const CHANGED_MESSAGE = "ใบสั่งซื้อนี้มีการเปลี่ยนแปลงหลังจากที่คุณเปิดดู (เช่น มีผู้เพิ่มหรือแก้รายการ) กรุณารีเฟรชหน้าจอเพื่อตรวจรายการล่าสุดก่อนอนุมัติ";

/**
 * Approves an order in manager review: it becomes SUBMITTED (the Vendor can see it) only if its review token still equals
 * `expectedToken`. One transaction: the order is locked at PENDING_MANAGER_REVIEW first, then the token is re-read and
 * compared, then the status changes. Missing or different token: nothing is written.
 */
export async function approveManagerReview(sql: Sql, input: {
  po: { id: number };
  reviewer: string;
  expectedToken: unknown;
  scope: DepartmentScope;
}): Promise<ApproveResult> {
  const { po, reviewer, scope } = input;
  assertPurchaseOrderScope(scope, "approveManagerReview"); // before any SQL
  writeDepartmentId(scope); // mode "all" -> DEPARTMENT_READ_ONLY before anything else

  const expected = typeof input.expectedToken === "string" ? input.expectedToken.trim() : "";
  if (!/^[0-9a-f]{32}$/.test(expected)) return { ok: false, code: PO_REVIEW_CHANGED, error: CHANGED_MESSAGE };

  const responseDueAt = new Date(Date.now() + 5 * 86400000).toISOString();
  try {
    const results = await runGuardedPurchaseOrderUpdate(sql, po.id, "PENDING_MANAGER_REVIEW", [
      sql`SELECT labstock_assert(${expected} = ${reviewTokenExpression(sql, po.id)}, ${PO_REVIEW_CHANGED}) AS ok`,
      sql`
        UPDATE purchase_orders
        SET status = 'SUBMITTED', reviewed_at = NOW(), reviewed_by = ${reviewer},
            review_requested_at = COALESCE(review_requested_at, NOW()),
            vendor_response_due_at = ${responseDueAt},
            updated_at = NOW()
        WHERE id = ${po.id} AND status = 'PENDING_MANAGER_REVIEW'
        RETURNING id
      `,
    ], scope);
    const updated = results?.[1] as unknown[] | undefined;
    if (!updated || updated.length === 0) return { ok: false, code: "PO_STATE_CHANGED", error: "This order was already reviewed." };
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message.includes(PO_REVIEW_CHANGED)) return { ok: false, code: PO_REVIEW_CHANGED, error: CHANGED_MESSAGE };
    throw error;
  }
}
