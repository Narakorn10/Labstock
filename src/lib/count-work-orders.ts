import sql from "@/lib/db";
import type { AuthenticatedUser } from "@/lib/auth-utils";
import { AppError } from "@/lib/errors";

export type CountWorkOrderStatus = "OPEN" | "CONFIRMED" | "CANCELLED";
export type CountInput = { itemId: string; countedQty: number };
export type AllocationInput = { itemId: string; inventoryId: number; qty: number };

export function requiredQty(weeklyTarget: number, countedQty: number) {
  return Math.max(Number(weeklyTarget) - Number(countedQty), 0);
}

export function normalizeAllocations(allocations: AllocationInput[]) {
  const grouped = new Map<string, AllocationInput>();
  for (const raw of allocations) {
    const itemId = String(raw.itemId || "").trim();
    const inventoryId = Number(raw.inventoryId);
    const qty = Number(raw.qty);
    if (!itemId || !Number.isInteger(inventoryId) || inventoryId <= 0 || !Number.isFinite(qty) || qty <= 0) {
      throw new AppError("VALIDATION_FAILED", { message: "ข้อมูล Lot สำหรับการเบิกไม่ถูกต้อง", detail: "ข้อมูล Lot สำหรับการเบิกไม่ถูกต้อง" });
    }
    const key = `${itemId.toLowerCase()}:${inventoryId}`;
    const current = grouped.get(key);
    grouped.set(key, { itemId: current?.itemId || itemId, inventoryId, qty: (current?.qty || 0) + qty });
  }
  return [...grouped.values()];
}

function assertLabUser(user: AuthenticatedUser) {
  if (user.role === "Vendor") throw new AppError("FORBIDDEN", { message: "Vendor ไม่มีสิทธิ์เข้าถึงใบงานนับสต็อก", detail: "Vendor ไม่มีสิทธิ์เข้าถึงใบงานนับสต็อก" });
}

export async function listCountWorkOrders(user: AuthenticatedUser) {
  assertLabUser(user);
  const isReviewer = user.role === "Admin" || user.role === "Manager";
  return sql`
    SELECT w.id, w.owner_username AS "ownerUsername", w.job_type AS "jobType", w.status,
           w.created_at AS "createdAt", w.updated_at AS "updatedAt", w.confirmed_at AS "confirmedAt",
           COUNT(i.id)::int AS "itemCount"
    FROM count_work_orders w
    LEFT JOIN count_work_order_items i ON i.work_order_id = w.id
    WHERE ${isReviewer} OR LOWER(w.owner_username) = LOWER(${user.username})
    GROUP BY w.id
    ORDER BY CASE w.status WHEN 'OPEN' THEN 0 ELSE 1 END, w.updated_at DESC
  `;
}

export async function saveCountWorkOrder(user: AuthenticatedUser, jobType: string, inputs: CountInput[]) {
  assertLabUser(user);
  const normalized = inputs.map((entry) => ({ itemId: String(entry.itemId || "").trim(), countedQty: Number(entry.countedQty) }))
    .filter((entry) => entry.itemId && Number.isFinite(entry.countedQty) && entry.countedQty >= 0);
  if (normalized.length === 0 || normalized.length !== inputs.length) throw new AppError("VALIDATION_FAILED", { message: "กรุณาระบุยอดนับที่ถูกต้องอย่างน้อยหนึ่งรายการ", detail: "กรุณาระบุยอดนับที่ถูกต้องอย่างน้อยหนึ่งรายการ" });
  const duplicate = new Set<string>();
  for (const item of normalized) {
    const key = item.itemId.toLowerCase();
    if (duplicate.has(key)) throw new AppError("VALIDATION_FAILED", { message: "พบรายการนับซ้ำในใบงาน", detail: "พบรายการนับซ้ำในใบงาน" });
    duplicate.add(key);
  }
  const safeJobType = String(jobType || "").trim();
  const payload = JSON.stringify(normalized);
  const inactive = await sql`
    SELECT item_id FROM master_data
    WHERE is_active = FALSE AND LOWER(item_id) IN (SELECT LOWER(TRIM(entry->>'itemId')) FROM JSONB_ARRAY_ELEMENTS(${payload}::jsonb) entry)
  ` as Array<{ item_id: string }>;
  if (inactive.length) {
    const text = `น้ำยาถูกปิดใช้งานแล้ว (${inactive.map((row) => row.item_id).join(", ")}) กรุณารีเฟรชหน้าแล้วนับใหม่`;
    throw new AppError("REAGENT_INACTIVE", { message: text, detail: `REAGENT_INACTIVE: ${text}` });
  }
  const [resultRows] = await sql.transaction([sql`
    WITH order_row AS (
      INSERT INTO count_work_orders (owner_username, job_type)
      VALUES (${user.username}, ${safeJobType})
      ON CONFLICT (LOWER(owner_username), job_type) WHERE status = 'OPEN'
      DO UPDATE SET updated_at = NOW()
      RETURNING id
    ), input_items AS (
      SELECT TRIM(entry->>'itemId') AS item_id, (entry->>'countedQty')::NUMERIC AS counted_qty
      FROM JSONB_ARRAY_ELEMENTS(${payload}::jsonb) entry
    ), already_dispensed AS (
      -- Items already dispensed from this open order keep their result; recounting them must not re-open a refill.
      SELECT ei.item_id FROM order_row o
      JOIN count_work_order_items ei ON ei.work_order_id = o.id
      JOIN input_items x ON LOWER(x.item_id) = LOWER(ei.item_id)
      WHERE EXISTS (SELECT 1 FROM count_work_order_allocations a WHERE a.work_order_item_id = ei.id)
    ), saved AS (
      INSERT INTO count_work_order_items (work_order_id, item_id, name, unit, weekly_target, counted_qty, required_qty, revision)
      SELECT o.id, m.item_id, m.name, m.unit, COALESCE(m.weekly_target, 0), x.counted_qty,
             GREATEST(COALESCE(m.weekly_target, 0) - x.counted_qty, 0), 1
      FROM order_row o JOIN input_items x ON TRUE
      JOIN master_data m ON LOWER(m.item_id) = LOWER(x.item_id)
      WHERE (${safeJobType} = '' OR m.job_type = ${safeJobType})
        AND NOT EXISTS (SELECT 1 FROM already_dispensed d WHERE LOWER(d.item_id) = LOWER(m.item_id))
      ON CONFLICT (work_order_id, item_id) DO UPDATE SET
        counted_qty = EXCLUDED.counted_qty, required_qty = EXCLUDED.required_qty,
        revision = count_work_order_items.revision + 1, updated_at = NOW()
      RETURNING id, work_order_id, item_id, counted_qty, required_qty, revision
    ), audit AS (
      INSERT INTO count_work_order_audit (work_order_id, work_order_item_id, action, actor_username, after_data)
      SELECT work_order_id, id, 'COUNT_SAVED', ${user.username}, jsonb_build_object('countedQty', counted_qty, 'requiredQty', required_qty, 'revision', revision)
      FROM saved
    )
    SELECT (SELECT id FROM order_row) AS id, COUNT(*)::int AS "savedCount",
      (SELECT COALESCE(jsonb_agg(item_id), '[]'::jsonb) FROM already_dispensed) AS "alreadyDispensed"
    FROM saved
  `]);
  const result = resultRows[0] as { id: number; savedCount: number; alreadyDispensed: string[] } | undefined;
  const alreadyDispensed = result?.alreadyDispensed || [];
  if (Number(result?.savedCount || 0) + alreadyDispensed.length !== normalized.length) throw new AppError("VALIDATION_FAILED", { message: "ไม่พบรายการหรือรายการไม่ตรงกับหน่วยงานของใบงาน", detail: "ไม่พบรายการหรือรายการไม่ตรงกับหน่วยงานของใบงาน" });
  return { id: Number(result!.id), savedCount: Number(result!.savedCount), alreadyDispensed };
}

export async function getCountWorkOrder(user: AuthenticatedUser, id: number) {
  assertLabUser(user);
  const isReviewer = user.role === "Admin" || user.role === "Manager";
  const orders = await sql`
    SELECT id, owner_username AS "ownerUsername", job_type AS "jobType", status, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM count_work_orders WHERE id = ${id} AND (${isReviewer} OR LOWER(owner_username) = LOWER(${user.username})) LIMIT 1
  `;
  if (!orders[0]) return null;
  const items = await sql`
    SELECT i.id, i.item_id AS "itemId", i.name, i.unit, i.weekly_target AS "weeklyTarget", i.counted_qty AS "countedQty", i.required_qty AS "requiredQty", i.revision,
      NOT EXISTS (SELECT 1 FROM master_data m WHERE LOWER(m.item_id) = LOWER(i.item_id) AND m.is_active = FALSE) AS "isActive",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('inventoryId', a.inventory_id, 'qty', a.qty, 'lotNo', inv.lot_no, 'createdAt', a.created_at) ORDER BY a.id)
        FROM count_work_order_allocations a LEFT JOIN inventory inv ON inv.id = a.inventory_id WHERE a.work_order_item_id = i.id), '[]'::jsonb) AS allocations
    FROM count_work_order_items i WHERE i.work_order_id = ${id} ORDER BY i.item_id
  `;
  return { ...(orders[0] as { id: number; ownerUsername: string; jobType: string; status: CountWorkOrderStatus }), items };
}

export async function cancelCountWorkOrder(user: AuthenticatedUser, id: number) {
  assertLabUser(user);
  const updated = await sql`
    UPDATE count_work_orders SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = ${user.username}, updated_at = NOW()
    WHERE id = ${id} AND status = 'OPEN' AND LOWER(owner_username) = LOWER(${user.username}) RETURNING id
  `;
  if (!updated[0]) throw new AppError("COUNT_ORDER_NOT_FOUND", { message: "ไม่พบใบงานที่เปิดอยู่หรือคุณไม่ใช่ผู้สร้าง", detail: "ไม่พบใบงานที่เปิดอยู่หรือคุณไม่ใช่ผู้สร้าง" });
  await sql`INSERT INTO count_work_order_audit (work_order_id, action, actor_username) VALUES (${id}, 'CANCELLED', ${user.username})`;
}

export async function getFreshLots(user: AuthenticatedUser, workOrderId: number) {
  const workOrder = await getCountWorkOrder(user, workOrderId);
  if (!workOrder) return null;
  const lots = await sql`
    SELECT i.id AS "inventoryId", i.item_id AS "itemId", i.lot_no AS "lotNo", i.quantity AS qty,
      TO_CHAR(i.exp_date, 'YYYY-MM-DD') AS "expDate", TO_CHAR(i.received_on, 'YYYY-MM-DD') AS "receivedOn"
    FROM inventory i JOIN count_work_order_items w ON LOWER(w.item_id) = LOWER(i.item_id)
    WHERE w.work_order_id = ${workOrderId} AND i.quantity > 0
    ORDER BY i.item_id, i.exp_date ASC NULLS LAST, i.received_on ASC, i.id ASC
  `;
  return lots;
}

export type ConfirmFailureReason = "INACTIVE" | "NOT_PENDING" | "QTY_MISMATCH" | "LOT_INVALID" | "INSUFFICIENT";
export type ConfirmFailure = { itemId: string; name: string | null; reason: ConfirmFailureReason; requiredQty: number | null; requestedQty: number; available: number };
export type ConfirmRemaining = { itemId: string; name: string; requiredQty: number };
export type ConfirmResult = {
  success: true; status: "CONFIRMED" | "OPEN"; message: string;
  dispensed: Array<{ itemId: string; name: string; qty: number }>; failed: ConfirmFailure[]; remaining: ConfirmRemaining[];
};

// Raised when nothing could be dispensed; carries the per-item reasons so the UI can explain what to do next.
export class CountConfirmError extends Error {
  constructor(message: string, readonly failed: ConfirmFailure[], readonly remaining: ConfirmRemaining[]) {
    super(message);
    this.name = "CountConfirmError";
  }
}

export async function confirmCountWorkOrder(user: AuthenticatedUser, id: number, allocations: AllocationInput[], audit: { userAgent: string; ipAddress: string }): Promise<ConfirmResult> {
  assertLabUser(user);
  const normalized = normalizeAllocations(allocations);
  const payload = JSON.stringify(normalized);
  // Each requested item is checked on its own: items whose lots fully cover the required quantity are dispensed,
  // the rest are reported with a reason and stay in the open order. A dispensed item is zeroed so a replay cannot
  // dispense it twice. Deactivated reagents are never dispensed and do not hold the order open.
  const [resultRows] = await sql.transaction([sql`
    WITH locked_order AS (
      SELECT id FROM count_work_orders WHERE id = ${id} AND status = 'OPEN' AND LOWER(owner_username) = LOWER(${user.username}) FOR UPDATE
    ), requested AS (
      SELECT LOWER(TRIM(entry->>'itemId')) AS item_key, TRIM(entry->>'itemId') AS raw_item_id,
        (entry->>'inventoryId')::BIGINT AS inventory_id, (entry->>'qty')::NUMERIC AS qty
      FROM JSONB_ARRAY_ELEMENTS(${payload}::jsonb) entry
    ), requested_totals AS (
      SELECT item_key, MIN(raw_item_id) AS raw_item_id, SUM(qty) AS qty FROM requested GROUP BY item_key
    ), pending AS (
      SELECT LOWER(i.item_id) AS item_key, i.id AS work_item_id, i.required_qty, i.item_id, i.name
      FROM count_work_order_items i JOIN locked_order o ON o.id = i.work_order_id WHERE i.required_qty > 0
        AND NOT EXISTS (SELECT 1 FROM master_data m WHERE LOWER(m.item_id) = LOWER(i.item_id) AND m.is_active = FALSE)
    ), locked_inventory AS (
      SELECT inv.id, inv.item_id, inv.lot_no, inv.quantity FROM inventory inv WHERE inv.id IN (SELECT inventory_id FROM requested) FOR UPDATE
    ), item_checks AS (
      SELECT t.item_key, COALESCE(p.item_id, m.item_id, t.raw_item_id) AS item_id, COALESCE(p.name, m.name) AS name,
        p.work_item_id, p.required_qty, t.qty AS requested_qty,
        (SELECT COALESCE(SUM(li.quantity), 0) FROM locked_inventory li JOIN requested r ON r.inventory_id = li.id
          WHERE r.item_key = t.item_key AND LOWER(li.item_id) = t.item_key) AS available,
        CASE
          WHEN m.is_active = FALSE THEN 'INACTIVE'
          WHEN p.item_key IS NULL THEN 'NOT_PENDING'
          WHEN t.qty <> p.required_qty THEN 'QTY_MISMATCH'
          WHEN EXISTS (SELECT 1 FROM requested r LEFT JOIN locked_inventory li ON li.id = r.inventory_id AND LOWER(li.item_id) = r.item_key
            WHERE r.item_key = t.item_key AND li.id IS NULL) THEN 'LOT_INVALID'
          WHEN EXISTS (SELECT 1 FROM requested r JOIN locked_inventory li ON li.id = r.inventory_id
            WHERE r.item_key = t.item_key AND li.quantity < r.qty) THEN 'INSUFFICIENT'
        END AS reason
      FROM requested_totals t
      LEFT JOIN pending p ON p.item_key = t.item_key
      LEFT JOIN LATERAL (SELECT md.item_id, md.name, md.is_active FROM master_data md WHERE LOWER(md.item_id) = t.item_key LIMIT 1) m ON TRUE
    ), ok_items AS (
      SELECT * FROM item_checks WHERE reason IS NULL
    ), ok_requested AS (
      SELECT r.* FROM requested r JOIN ok_items o ON o.item_key = r.item_key
    ), remaining AS (
      SELECT p.item_id, p.name, p.required_qty FROM pending p WHERE NOT EXISTS (SELECT 1 FROM ok_items o WHERE o.item_key = p.item_key)
    ), allocations_saved AS (
      INSERT INTO count_work_order_allocations (work_order_item_id, inventory_id, qty)
      SELECT o.work_item_id, r.inventory_id, r.qty FROM ok_requested r JOIN ok_items o ON o.item_key = r.item_key
      ON CONFLICT (work_order_item_id, inventory_id) DO UPDATE SET qty = EXCLUDED.qty
      RETURNING inventory_id
    ), deducted AS (
      UPDATE inventory inv SET quantity = inv.quantity - r.qty FROM ok_requested r
      WHERE inv.id = r.inventory_id
      RETURNING inv.item_id, inv.lot_no, r.qty
    ), logs_saved AS (
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address)
      SELECT d.item_id, o.name, d.lot_no, 'เบิกเติมจากใบงานนับสต็อก', d.qty, ${user.name + ' (' + user.role + ')'}, ${audit.userAgent}, ${audit.ipAddress}
      FROM deducted d JOIN ok_items o ON o.item_key = LOWER(d.item_id)
    ), closed AS (
      UPDATE count_work_orders SET status = 'CONFIRMED', confirmed_at = NOW(), updated_at = NOW()
      WHERE id IN (SELECT id FROM locked_order) AND NOT EXISTS (SELECT 1 FROM remaining)
      RETURNING id
    ), dispensed_items AS (
      UPDATE count_work_order_items i SET required_qty = 0, updated_at = NOW() FROM ok_items o
      WHERE i.id = o.work_item_id
      RETURNING i.id
    ), audit_saved AS (
      INSERT INTO count_work_order_audit (work_order_id, action, actor_username, after_data)
      SELECT ${id}, CASE WHEN EXISTS (SELECT 1 FROM closed) THEN 'CONFIRMED' ELSE 'PARTIAL_CONFIRMED' END, ${user.username},
        jsonb_build_object('allocationCount', (SELECT COUNT(*) FROM allocations_saved), 'remainingItems', (SELECT COUNT(*) FROM remaining),
          'dispensedItems', (SELECT COALESCE(jsonb_agg(item_id), '[]'::jsonb) FROM ok_items),
          'failedItems', (SELECT COALESCE(jsonb_agg(jsonb_build_object('itemId', item_id, 'reason', reason)), '[]'::jsonb) FROM item_checks WHERE reason IS NOT NULL))
      WHERE EXISTS (SELECT 1 FROM ok_items) OR EXISTS (SELECT 1 FROM closed)
    )
    SELECT (SELECT COUNT(*) FROM locked_order)::int AS "owned", (SELECT COUNT(*) FROM closed)::int AS "closed",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('itemId', item_id, 'name', name, 'qty', requested_qty)), '[]'::jsonb) FROM ok_items) AS "dispensed",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('itemId', item_id, 'name', name, 'reason', reason, 'requiredQty', required_qty,
        'requestedQty', requested_qty, 'available', available)), '[]'::jsonb) FROM item_checks WHERE reason IS NOT NULL) AS "failed",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('itemId', item_id, 'name', name, 'requiredQty', required_qty)), '[]'::jsonb) FROM remaining) AS "remaining"
  `]);
  const result = resultRows[0] as { owned: number; closed: number; dispensed: ConfirmResult["dispensed"]; failed: ConfirmFailure[]; remaining: ConfirmRemaining[] } | undefined;
  if (!result?.owned) throw new AppError("COUNT_ORDER_NOT_FOUND", { message: "ไม่พบใบงานที่เปิดอยู่หรือคุณไม่ใช่ผู้สร้าง", detail: "ไม่พบใบงานที่เปิดอยู่หรือคุณไม่ใช่ผู้สร้าง" });
  const dispensed = result.dispensed.map((item) => ({ ...item, qty: Number(item.qty) }));
  const failed = result.failed.map((item) => ({
    ...item, requiredQty: item.requiredQty === null ? null : Number(item.requiredQty), requestedQty: Number(item.requestedQty), available: Number(item.available),
  }));
  const remaining = result.remaining.map((item) => ({ ...item, requiredQty: Number(item.requiredQty) }));
  if (Number(result.closed) === 1) {
    return { success: true, status: "CONFIRMED", message: "ยืนยันเบิกจากใบงานเรียบร้อยแล้ว", dispensed, failed, remaining };
  }
  if (dispensed.length > 0) {
    return { success: true, status: "OPEN", message: `เบิกสำเร็จ ${dispensed.length} รายการ ใบงานยังเปิดอยู่ (เหลืออีก ${remaining.length} รายการ)`, dispensed, failed, remaining };
  }
  throw new CountConfirmError("ไม่มีรายการที่เบิกได้ กรุณาตรวจสอบรายการที่แจ้ง", failed, remaining);
}
