import sql from "@/lib/db";
import type { AuthenticatedUser } from "@/lib/auth-utils";

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
      throw new Error("ข้อมูล Lot สำหรับการเบิกไม่ถูกต้อง");
    }
    const key = `${itemId.toLowerCase()}:${inventoryId}`;
    const current = grouped.get(key);
    grouped.set(key, { itemId: current?.itemId || itemId, inventoryId, qty: (current?.qty || 0) + qty });
  }
  return [...grouped.values()];
}

function assertLabUser(user: AuthenticatedUser) {
  if (user.role === "Vendor") throw new Error("Vendor ไม่มีสิทธิ์เข้าถึงใบงานนับสต็อก");
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
  if (normalized.length === 0 || normalized.length !== inputs.length) throw new Error("กรุณาระบุยอดนับที่ถูกต้องอย่างน้อยหนึ่งรายการ");
  const duplicate = new Set<string>();
  for (const item of normalized) {
    const key = item.itemId.toLowerCase();
    if (duplicate.has(key)) throw new Error("พบรายการนับซ้ำในใบงาน");
    duplicate.add(key);
  }
  const safeJobType = String(jobType || "").trim();
  const payload = JSON.stringify(normalized);
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
    ), saved AS (
      INSERT INTO count_work_order_items (work_order_id, item_id, name, unit, weekly_target, counted_qty, required_qty, revision)
      SELECT o.id, m.item_id, m.name, m.unit, COALESCE(m.weekly_target, 0), x.counted_qty,
             GREATEST(COALESCE(m.weekly_target, 0) - x.counted_qty, 0), 1
      FROM order_row o JOIN input_items x ON TRUE
      JOIN master_data m ON LOWER(m.item_id) = LOWER(x.item_id)
      WHERE ${safeJobType} = '' OR m.job_type = ${safeJobType}
      ON CONFLICT (work_order_id, item_id) DO UPDATE SET
        counted_qty = EXCLUDED.counted_qty, required_qty = EXCLUDED.required_qty,
        revision = count_work_order_items.revision + 1, updated_at = NOW()
      RETURNING id, work_order_id, item_id, counted_qty, required_qty, revision
    ), audit AS (
      INSERT INTO count_work_order_audit (work_order_id, work_order_item_id, action, actor_username, after_data)
      SELECT work_order_id, id, 'COUNT_SAVED', ${user.username}, jsonb_build_object('countedQty', counted_qty, 'requiredQty', required_qty, 'revision', revision)
      FROM saved
    )
    SELECT (SELECT id FROM order_row) AS id, COUNT(*)::int AS "savedCount" FROM saved
  `]);
  const result = resultRows[0] as { id: number; savedCount: number } | undefined;
  if (Number(result?.savedCount || 0) !== normalized.length) throw new Error("ไม่พบรายการหรือรายการไม่ตรงกับหน่วยงานของใบงาน");
  return { id: Number(result!.id), savedCount: Number(result!.savedCount) };
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
      COALESCE((SELECT jsonb_agg(jsonb_build_object('inventoryId', a.inventory_id, 'qty', a.qty) ORDER BY a.id) FROM count_work_order_allocations a WHERE a.work_order_item_id = i.id), '[]'::jsonb) AS allocations
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
  if (!updated[0]) throw new Error("ไม่พบใบงานที่เปิดอยู่หรือคุณไม่ใช่ผู้สร้าง");
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

export async function confirmCountWorkOrder(user: AuthenticatedUser, id: number, allocations: AllocationInput[], audit: { userAgent: string; ipAddress: string }) {
  assertLabUser(user);
  const normalized = normalizeAllocations(allocations);
  const payload = JSON.stringify(normalized);
  // Only the requested items are dispensed. Other items still waiting for a refill keep the order OPEN,
  // and a dispensed item is zeroed so replaying the same request cannot dispense it twice.
  const [resultRows] = await sql.transaction([sql`
    WITH locked_order AS (
      SELECT id FROM count_work_orders WHERE id = ${id} AND status = 'OPEN' AND LOWER(owner_username) = LOWER(${user.username}) FOR UPDATE
    ), requested AS (
      SELECT LOWER(TRIM(entry->>'itemId')) AS item_key, (entry->>'inventoryId')::BIGINT AS inventory_id, (entry->>'qty')::NUMERIC AS qty
      FROM JSONB_ARRAY_ELEMENTS(${payload}::jsonb) entry
    ), requested_totals AS (
      SELECT item_key, SUM(qty) AS qty FROM requested GROUP BY item_key
    ), pending AS (
      SELECT LOWER(i.item_id) AS item_key, i.id AS work_item_id, i.required_qty, i.item_id, i.name
      FROM count_work_order_items i JOIN locked_order o ON o.id = i.work_order_id WHERE i.required_qty > 0
    ), requirements AS (
      SELECT p.* FROM pending p WHERE EXISTS (SELECT 1 FROM requested r WHERE r.item_key = p.item_key)
    ), remaining AS (
      SELECT COUNT(*)::int AS n FROM pending p WHERE NOT EXISTS (SELECT 1 FROM requested r WHERE r.item_key = p.item_key)
    ), valid AS (
      SELECT EXISTS (SELECT 1 FROM requested) AND NOT EXISTS (
        SELECT 1 FROM requirements r LEFT JOIN requested_totals q ON q.item_key = r.item_key WHERE COALESCE(q.qty, 0) <> r.required_qty
      ) AND NOT EXISTS (SELECT 1 FROM requested r LEFT JOIN pending q ON q.item_key = r.item_key WHERE q.item_key IS NULL) AND NOT EXISTS (
        SELECT 1 FROM requested r LEFT JOIN inventory inv ON inv.id = r.inventory_id AND LOWER(inv.item_id) = r.item_key WHERE inv.id IS NULL
      ) AS ok
    ), locked_inventory AS (
      SELECT inv.id, inv.item_id, inv.lot_no, inv.quantity FROM inventory inv JOIN requested r ON r.inventory_id = inv.id FOR UPDATE
    ), sufficient AS (
      SELECT NOT EXISTS (SELECT 1 FROM requested r JOIN locked_inventory inv ON inv.id = r.inventory_id WHERE inv.quantity < r.qty) AS ok
    ), allocations_saved AS (
      INSERT INTO count_work_order_allocations (work_order_item_id, inventory_id, qty)
      SELECT req.work_item_id, r.inventory_id, r.qty FROM requested r JOIN requirements req ON req.item_key = r.item_key
      WHERE (SELECT ok FROM valid) AND (SELECT ok FROM sufficient)
      ON CONFLICT (work_order_item_id, inventory_id) DO UPDATE SET qty = EXCLUDED.qty
      RETURNING inventory_id
    ), deducted AS (
      UPDATE inventory inv SET quantity = inv.quantity - r.qty FROM requested r
      WHERE inv.id = r.inventory_id AND (SELECT ok FROM valid) AND (SELECT ok FROM sufficient)
      RETURNING inv.item_id, inv.lot_no, r.qty
    ), logs_saved AS (
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address)
      SELECT d.item_id, req.name, d.lot_no, 'เบิกเติมจากใบงานนับสต็อก', d.qty, ${user.name + ' (' + user.role + ')'}, ${audit.userAgent}, ${audit.ipAddress}
      FROM deducted d JOIN requirements req ON LOWER(req.item_id) = LOWER(d.item_id)
    ), closed AS (
      UPDATE count_work_orders SET status = 'CONFIRMED', confirmed_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND (SELECT ok FROM valid) AND (SELECT ok FROM sufficient) AND (SELECT n FROM remaining) = 0
      RETURNING id
    ), dispensed_items AS (
      UPDATE count_work_order_items i SET required_qty = 0, updated_at = NOW() FROM requirements req
      WHERE i.id = req.work_item_id AND (SELECT ok FROM valid) AND (SELECT ok FROM sufficient) AND (SELECT n FROM remaining) > 0
      RETURNING i.id
    ), audit_saved AS (
      INSERT INTO count_work_order_audit (work_order_id, action, actor_username, after_data)
      SELECT ${id}, CASE WHEN (SELECT n FROM remaining) = 0 THEN 'CONFIRMED' ELSE 'PARTIAL_CONFIRMED' END, ${user.username},
        jsonb_build_object('allocationCount', (SELECT COUNT(*) FROM allocations_saved), 'remainingItems', (SELECT n FROM remaining))
      WHERE (SELECT ok FROM valid) AND (SELECT ok FROM sufficient)
    )
    SELECT (SELECT COUNT(*) FROM locked_order)::int AS "owned", (SELECT ok FROM valid) AS valid,
      (SELECT ok FROM sufficient) AS sufficient, (SELECT COUNT(*) FROM closed)::int AS "closed",
      (SELECT n FROM remaining) AS "remaining", (SELECT COUNT(*) FROM deducted)::int AS "dispensed"
  `]);
  const result = resultRows[0] as { owned: number; valid: boolean; sufficient: boolean; closed: number; remaining: number; dispensed: number } | undefined;
  if (!result?.owned) throw new Error("ไม่พบใบงานที่เปิดอยู่หรือคุณไม่ใช่ผู้สร้าง");
  if (!result.valid) throw new Error("ยอดจัดสรร Lot ต้องครบและตรงกับยอดที่ต้องเบิกทุกรายการ");
  if (!result.sufficient) throw new Error("Lot มีจำนวนไม่พอหรือถูกเบิกไปก่อนหน้า กรุณาโหลด Lot ล่าสุดแล้วเลือกใหม่");
  if (Number(result.closed) === 1) return { success: true, message: "ยืนยันเบิกจากใบงานเรียบร้อยแล้ว" };
  if (Number(result.remaining) > 0 && Number(result.dispensed) > 0) {
    return { success: true, message: `เบิกตามรายการที่เลือกแล้ว ใบงานยังเปิดอยู่ (เหลืออีก ${Number(result.remaining)} รายการ)` };
  }
  throw new Error("ยืนยันใบงานไม่สำเร็จ");
}
