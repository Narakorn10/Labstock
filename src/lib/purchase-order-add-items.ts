import type sqlClient from "./db";
import { buildAuditedPurchaseOrderItem } from "./purchase-order-creation";
import { PurchaseOrderCreationError } from "./purchase-order-creation-errors";
import { getPurchaseOrderSuggestions } from "./purchase-order-suggestions";
import { assertPurchaseOrderScope, runGuardedPurchaseOrderUpdate } from "./purchase-order-review";
import { describeInvalidPurchaseOrderItems, validatePurchaseOrderItems } from "./purchase-order-workflow";
import { andDept, writeDepartmentId, type DepartmentScope } from "./scoped-db";

type Sql = typeof sqlClient;

// A manager adds reagent lines to a Lab order that is still waiting for their review (PENDING_MANAGER_REVIEW).
//   - ADD ONLY. Existing lines are never changed or removed here (quantity edits stay in UPDATE_UNACKNOWLEDGED_LAB_ORDER).
//   - Only while PENDING_MANAGER_REVIEW: from SUBMITTED on the Vendor can see the order, so it can no longer grow.
//   - Each new line goes through the same checks as when an order is created: same company as the order, active reagent
//     of this room, name and unit taken from the system (never from the browser), a stored suggestion snapshot, and a
//     documented reason for a manual quantity.
//   - One transaction: the order row is locked at its expected status, the new lines are inserted only if none of them is
//     stale (stock / open orders moved since the suggestion was computed), inactive or already on the order. Otherwise
//     nothing is written, and the answer says which of those it was.

export type AddedOrderItem = { item_id: string; item_name: string; quantity: number; unit: string; override_reason: string | null };

export type AddItemsResult =
  | { ok: true; items: AddedOrderItem[] }
  | { ok: false; httpStatus: number; error: string };

const fail = (httpStatus: number, error: string): { ok: false; httpStatus: number; error: string } => ({ ok: false, httpStatus, error });

export async function addItemsToManagerReviewOrder(sql: Sql, input: {
  po: { id: number; vendor: string; status: string; proposal_origin: string };
  items: unknown;
  scope: DepartmentScope;
}): Promise<AddItemsResult> {
  const { po, scope } = input;
  assertPurchaseOrderScope(scope, "addItemsToManagerReviewOrder"); // before any SQL
  writeDepartmentId(scope); // mode "all" -> DEPARTMENT_READ_ONLY before anything else

  if (po.proposal_origin !== "LAB" || po.status !== "PENDING_MANAGER_REVIEW") {
    return fail(409, "เพิ่มรายการได้เฉพาะใบสั่งซื้อที่ยังรอหัวหน้าตรวจสอบ (ยังไม่ได้ส่งให้บริษัท)");
  }
  const requested = validatePurchaseOrderItems(input.items);
  if (!requested) return fail(400, describeInvalidPurchaseOrderItems(input.items));

  const existing = await sql`SELECT item_id FROM purchase_order_items WHERE po_id = ${po.id}`;
  const onOrder = new Set(existing.map((row) => String(row.item_id)));
  const repeated = requested.find((item) => onOrder.has(item.item_id));
  if (repeated) return fail(409, `${repeated.item_name || repeated.item_id}: มีอยู่ในใบสั่งซื้อนี้แล้ว หากต้องการแก้จำนวนให้ใช้การแก้ไขรายการเดิม`);

  let audited;
  try {
    // Exactly the submitted lines, including reagents without an order policy (those need a reason), for THIS company.
    const suggestions = await getPurchaseOrderSuggestions(sql, {
      vendor: po.vendor,
      itemIds: requested.map((item) => item.item_id),
      includeUnconfigured: true,
      includeAll: true,
    }, scope);
    const byItemId = new Map(suggestions.map((suggestion) => [suggestion.item_id, suggestion]));
    const calculatedAt = new Date().toISOString();
    audited = requested.map((item) => {
      const suggestion = byItemId.get(item.item_id);
      if (!suggestion || suggestion.vendor !== po.vendor) {
        throw new PurchaseOrderCreationError(`${item.item_name || item.item_id}: ไม่ใช่น้ำยาที่ใช้งานอยู่ของบริษัท ${po.vendor}`);
      }
      return buildAuditedPurchaseOrderItem(item, suggestion, "LAB", calculatedAt);
    });
  } catch (error) {
    if (error instanceof PurchaseOrderCreationError) return fail(error.status, error.message);
    throw error;
  }

  const itemJson = JSON.stringify(audited);
  const itemIds = audited.map((item) => item.item_id).sort();
  // Same per-reagent lock as order creation: two people ordering the same reagent at the same moment are handled one after the other.
  const lockQuery = sql`
    SELECT pg_advisory_xact_lock(hashtextextended(item_id, 0))
    FROM unnest(${itemIds}::text[]) AS locked(item_id)
    ORDER BY item_id
  `;
  // current_open is deliberately NOT filtered by department, like creation (item_id is a system-wide key; keep it in step
  // with the on_order CTE of purchase-order-suggestions.ts).
  const insertQuery = sql`
    WITH input_rows AS (
      SELECT * FROM jsonb_to_recordset(${itemJson}::jsonb) AS item(
        item_id TEXT, item_name TEXT, quantity NUMERIC, unit TEXT,
        system_suggested_qty NUMERIC, override_reason TEXT, calculation_version TEXT,
        calculation_snapshot JSONB, selected_basis TEXT,
        snapshot_on_order_qty NUMERIC, snapshot_no_eta_qty NUMERIC
      )
    ), inactive_items AS (
      SELECT input.item_id
      FROM input_rows input
      LEFT JOIN master_data master ON master.item_id = input.item_id${andDept(scope, "master")}
      WHERE master.item_id IS NULL OR master.is_active = FALSE
    ), current_open AS (
      SELECT poi.item_id,
        COALESCE(SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0)) FILTER (WHERE p.expected_date IS NOT NULL), 0) AS on_order_qty,
        COALESCE(SUM(GREATEST(poi.quantity - COALESCE(poi.received_qty, 0), 0)) FILTER (WHERE p.expected_date IS NULL), 0) AS no_eta_qty
      FROM purchase_order_items poi
      JOIN purchase_orders p ON p.id = poi.po_id
      JOIN input_rows input ON input.item_id = poi.item_id
      WHERE p.status IN ('PENDING_MANAGER_REVIEW', 'SUBMITTED', 'ACKNOWLEDGED', 'REVISION_REQUESTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_RECEIVED')
      GROUP BY poi.item_id
    ), stale_items AS (
      SELECT input.item_id
      FROM input_rows input
      LEFT JOIN current_open current ON current.item_id = input.item_id
      WHERE COALESCE(current.on_order_qty, 0) IS DISTINCT FROM input.snapshot_on_order_qty
         OR COALESCE(current.no_eta_qty, 0) IS DISTINCT FROM input.snapshot_no_eta_qty
    ), duplicate_items AS (
      SELECT poi.item_id FROM purchase_order_items poi
      JOIN input_rows input ON input.item_id = poi.item_id
      WHERE poi.po_id = ${po.id}
    ), new_items AS (
      INSERT INTO purchase_order_items (
        po_id, item_id, item_name, quantity, unit, system_suggested_qty,
        override_reason, calculation_version, calculation_snapshot, selected_basis,
        reagent_type, job_type, machine_type
      )
      SELECT ${po.id}, item.item_id, item.item_name, item.quantity, item.unit,
        item.system_suggested_qty, item.override_reason, item.calculation_version,
        item.calculation_snapshot, item.selected_basis,
        master.reagent_type, master.job_type, master.machine_type
      FROM input_rows item
      JOIN master_data master ON master.item_id = item.item_id${andDept(scope, "master")}
      WHERE NOT EXISTS (SELECT 1 FROM stale_items)
        AND NOT EXISTS (SELECT 1 FROM inactive_items)
        AND NOT EXISTS (SELECT 1 FROM duplicate_items)
      RETURNING item_id
    ), touched AS (
      UPDATE purchase_orders SET updated_at = NOW()
      WHERE id = ${po.id} AND EXISTS (SELECT 1 FROM new_items)
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM new_items) AS inserted,
      (SELECT COUNT(*)::int FROM stale_items) AS stale,
      (SELECT COUNT(*)::int FROM inactive_items) AS inactive,
      (SELECT COUNT(*)::int FROM duplicate_items) AS duplicates
  `;

  const results = await runGuardedPurchaseOrderUpdate(sql, po.id, "PENDING_MANAGER_REVIEW", [lockQuery, insertQuery], scope);
  if (!results) return fail(409, "ใบสั่งซื้อนี้ถูกอนุมัติหรือเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้าจอ");

  const summary = (results[1] as Array<Record<string, unknown>>)[0] ?? {};
  if (Number(summary.inserted) !== audited.length) {
    if (Number(summary.duplicates) > 0) return fail(409, "มีรายการที่เพิ่มเข้าใบนี้ไปแล้ว กรุณารีเฟรชหน้าจอ");
    if (Number(summary.inactive) > 0) return fail(409, "มีน้ำยาที่ปิดใช้งานหรือไม่ได้อยู่ในห้องนี้ กรุณาเลือกใหม่");
    if (Number(summary.stale) > 0) return fail(409, "สถานะสต็อกหรือใบสั่งซื้ออื่นเปลี่ยนไประหว่างคำนวณ กรุณาเปิดตัวเลือกน้ำยาใหม่แล้วลองอีกครั้ง");
    return fail(409, "เพิ่มรายการไม่สำเร็จ กรุณารีเฟรชหน้าจอแล้วลองอีกครั้ง");
  }

  return {
    ok: true,
    items: audited.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      quantity: item.quantity,
      unit: item.unit,
      override_reason: item.override_reason,
    })),
  };
}
