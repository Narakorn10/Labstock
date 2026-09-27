import sql from "./db";
import type { AuthenticatedUser } from "./auth-utils";
import { getPurchaseOrderSuggestions, type PurchaseOrderSuggestion } from "./purchase-order-suggestions";
import type { PurchaseOrderItemInput } from "./purchase-order-workflow";

type CreatePurchaseOrderInput = {
  user: AuthenticatedUser;
  vendor: string;
  items: PurchaseOrderItemInput[];
  note: string | null;
  expectedDate: string | null;
  origin: "LAB" | "VENDOR";
  liffRequestId?: string | null;
  storeLiffRequestId?: boolean;
};

type AuditedPurchaseOrderItem = {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  system_suggested_qty: number;
  override_reason: string | null;
  calculation_version: string;
  calculation_snapshot: PurchaseOrderSuggestion & { calculated_at: string };
  selected_basis: "POLICY" | "DYNAMIC" | "MANUAL";
  snapshot_on_order_qty: number;
  snapshot_no_eta_qty: number;
};

export class PurchaseOrderCreationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export function selectPurchaseOrderBasis(item: PurchaseOrderItemInput, suggestion: PurchaseOrderSuggestion) {
  const requested = item.selected_basis;
  if (requested === "POLICY" && item.quantity === suggestion.policy_order_qty) return "POLICY" as const;
  if (requested === "DYNAMIC" && item.quantity === suggestion.dynamic_order_qty) return "DYNAMIC" as const;
  if (!requested && item.quantity === suggestion.policy_order_qty) return "POLICY" as const;
  if (!requested && item.quantity === suggestion.dynamic_order_qty) return "DYNAMIC" as const;
  return "MANUAL" as const;
}

export function buildAuditedPurchaseOrderItem(
  item: PurchaseOrderItemInput,
  suggestion: PurchaseOrderSuggestion,
  origin: "LAB" | "VENDOR",
  calculatedAt = new Date().toISOString(),
): AuditedPurchaseOrderItem {
  // A reagent without an enabled order policy has no approved quantity to fall back on,
  // so it is always a manual quantity that needs a documented reason.
  const policyConfigured = suggestion.policy_configured !== false;
  const selectedBasis = policyConfigured ? selectPurchaseOrderBasis(item, suggestion) : "MANUAL";
  const overrideReason = item.override_reason?.trim() || null;
  if (!policyConfigured && !overrideReason) {
    throw new PurchaseOrderCreationError(
      `${suggestion.name}: ยังไม่ได้ตั้งนโยบายสั่งซื้อ กรุณาระบุเหตุผลที่สั่ง`,
    );
  }
  const requiresReviewReason = origin === "LAB" && selectedBasis === "MANUAL";
  if (requiresReviewReason && !overrideReason) {
    throw new PurchaseOrderCreationError(
      `${suggestion.name}: กรุณาระบุเหตุผลเมื่อแก้จำนวนเอง`,
    );
  }

  return {
    item_id: item.item_id,
    item_name: suggestion.name,
    quantity: item.quantity,
    unit: suggestion.unit,
    system_suggested_qty: suggestion.dynamic_order_qty,
    override_reason: overrideReason,
    calculation_version: suggestion.calculation_version,
    calculation_snapshot: { ...suggestion, calculated_at: calculatedAt },
    selected_basis: selectedBasis,
    snapshot_on_order_qty: suggestion.on_order_qty,
    snapshot_no_eta_qty: suggestion.committed_no_eta_qty,
  };
}

async function recomputeItems(input: CreatePurchaseOrderInput): Promise<AuditedPurchaseOrderItem[]> {
  // Re-check exactly the submitted items, including reagents without an order policy.
  const suggestions = await getPurchaseOrderSuggestions(sql, {
    vendor: input.vendor,
    itemIds: input.items.map((item) => item.item_id),
    includeUnconfigured: true,
    includeAll: true,
  });
  const byItemId = new Map(suggestions.map((suggestion) => [suggestion.item_id, suggestion]));
  const calculatedAt = new Date().toISOString();

  return input.items.map((item) => {
    const suggestion = byItemId.get(item.item_id);
    if (!suggestion || suggestion.vendor !== input.vendor) {
      throw new PurchaseOrderCreationError(
        `${item.item_name || item.item_id}: ไม่ใช่น้ำยาที่ใช้งานอยู่ของบริษัท ${input.vendor}`,
      );
    }

    return buildAuditedPurchaseOrderItem(item, suggestion, input.origin, calculatedAt);
  });
}

export async function createPurchaseOrderWithAudit(input: CreatePurchaseOrderInput) {
  const auditedItems = await recomputeItems(input);
  // The PO number is assigned inside the insert, under a per-day lock, so concurrent
  // creations cannot pick the same number (COUNT+1 outside the transaction could).
  const poDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const poNumberPattern = `^PO-${poDate}-[0-9]+$`;
  const numberLockQuery = sql`SELECT pg_advisory_xact_lock(hashtextextended(${`purchase_order_number:${poDate}`}, 0))`;
  // A Lab-originated PO must be reviewed by a Manager before the Vendor can see it.
  const status = input.origin === "VENDOR" ? "PENDING_LAB_REVIEW" : "PENDING_MANAGER_REVIEW";
  const reviewRequestedAt = new Date().toISOString();
  const itemJson = JSON.stringify(auditedItems);
  const itemIds = auditedItems.map((item) => item.item_id).sort();
  const lockQuery = sql`
    SELECT pg_advisory_xact_lock(hashtextextended(item_id, 0))
    FROM unnest(${itemIds}::text[]) AS locked(item_id)
    ORDER BY item_id
  `;

  const query = input.storeLiffRequestId
    ? sql`
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
        LEFT JOIN master_data master ON master.item_id = input.item_id
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
      ), issuer AS (
        -- to_jsonb keeps PO creation working before upgrade_v27 adds users.department.
        SELECT organization_name,
          COALESCE(
            NULLIF(TRIM((SELECT to_jsonb(u) ->> 'department' FROM users u WHERE u.username = ${input.user.username})), ''),
            department_name
          ) AS department_name,
          address, phone, email, logo_url
        FROM lab_profile
        WHERE id = 1
      ), po_seq AS (
        SELECT 'PO-' || ${poDate} || '-' || LPAD((COALESCE(MAX(substring(po_number from '([0-9]+)$')::int), 0) + 1)::text, 3, '0') AS po_number
        FROM purchase_orders
        WHERE po_number ~ ${poNumberPattern}
      ), new_po AS (
        INSERT INTO purchase_orders (
          po_number, vendor, note, expected_date, created_by, status, proposal_origin,
          review_requested_at, liff_request_id, issuer_name, issuer_department,
          issuer_address, issuer_phone, issuer_email, issuer_logo_url
        ) SELECT
          (SELECT po_number FROM po_seq), ${input.vendor}, ${input.note}, ${input.expectedDate}, ${input.user.username},
          ${status}, ${input.origin}, ${reviewRequestedAt}, ${input.liffRequestId || null},
          issuer.organization_name, issuer.department_name, issuer.address,
          issuer.phone, issuer.email, issuer.logo_url
        FROM issuer
        WHERE NOT EXISTS (SELECT 1 FROM stale_items)
          AND NOT EXISTS (SELECT 1 FROM inactive_items)
        RETURNING *
      ), new_items AS (
        INSERT INTO purchase_order_items (
          po_id, item_id, item_name, quantity, unit, system_suggested_qty,
          override_reason, calculation_version, calculation_snapshot, selected_basis,
          reagent_type, job_type, machine_type
        )
        SELECT new_po.id, item.item_id, item.item_name, item.quantity, item.unit,
          item.system_suggested_qty, item.override_reason, item.calculation_version,
          item.calculation_snapshot, item.selected_basis,
          master.reagent_type, master.job_type, master.machine_type
        FROM new_po
        CROSS JOIN input_rows item
        JOIN master_data master ON master.item_id = item.item_id
        RETURNING *
      )
      SELECT
        (SELECT to_jsonb(new_po) FROM new_po) AS purchase_order,
        (SELECT COALESCE(jsonb_agg(to_jsonb(new_items)), '[]'::jsonb) FROM new_items) AS items
    `
    : sql`
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
        LEFT JOIN master_data master ON master.item_id = input.item_id
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
      ), issuer AS (
        -- to_jsonb keeps PO creation working before upgrade_v27 adds users.department.
        SELECT organization_name,
          COALESCE(
            NULLIF(TRIM((SELECT to_jsonb(u) ->> 'department' FROM users u WHERE u.username = ${input.user.username})), ''),
            department_name
          ) AS department_name,
          address, phone, email, logo_url
        FROM lab_profile
        WHERE id = 1
      ), po_seq AS (
        SELECT 'PO-' || ${poDate} || '-' || LPAD((COALESCE(MAX(substring(po_number from '([0-9]+)$')::int), 0) + 1)::text, 3, '0') AS po_number
        FROM purchase_orders
        WHERE po_number ~ ${poNumberPattern}
      ), new_po AS (
        INSERT INTO purchase_orders (
          po_number, vendor, note, expected_date, created_by, status, proposal_origin,
          review_requested_at, issuer_name, issuer_department, issuer_address,
          issuer_phone, issuer_email, issuer_logo_url
        ) SELECT
          (SELECT po_number FROM po_seq), ${input.vendor}, ${input.note}, ${input.expectedDate}, ${input.user.username},
          ${status}, ${input.origin}, ${reviewRequestedAt}, issuer.organization_name,
          issuer.department_name, issuer.address, issuer.phone, issuer.email, issuer.logo_url
        FROM issuer
        WHERE NOT EXISTS (SELECT 1 FROM stale_items)
          AND NOT EXISTS (SELECT 1 FROM inactive_items)
        RETURNING *
      ), new_items AS (
        INSERT INTO purchase_order_items (
          po_id, item_id, item_name, quantity, unit, system_suggested_qty,
          override_reason, calculation_version, calculation_snapshot, selected_basis,
          reagent_type, job_type, machine_type
        )
        SELECT new_po.id, item.item_id, item.item_name, item.quantity, item.unit,
          item.system_suggested_qty, item.override_reason, item.calculation_version,
          item.calculation_snapshot, item.selected_basis,
          master.reagent_type, master.job_type, master.machine_type
        FROM new_po
        CROSS JOIN input_rows item
        JOIN master_data master ON master.item_id = item.item_id
        RETURNING *
      )
      SELECT
        (SELECT to_jsonb(new_po) FROM new_po) AS purchase_order,
        (SELECT COALESCE(jsonb_agg(to_jsonb(new_items)), '[]'::jsonb) FROM new_items) AS items
    `;

  const [, , transactionRows] = await sql.transaction([numberLockQuery, lockQuery, query]);
  const result = transactionRows[0] as { purchase_order?: Record<string, unknown>; items?: Record<string, unknown>[] } | undefined;
  if (!result?.purchase_order) {
    throw new PurchaseOrderCreationError("สถานะสต็อกหรือ PO ค้างเปลี่ยนไประหว่างคำนวณ กรุณากดแนะนำอัตโนมัติและตรวจสอบอีกครั้ง", 409);
  }

  return {
    purchaseOrder: result.purchase_order,
    items: Array.isArray(result.items) ? result.items : [],
  };
}
