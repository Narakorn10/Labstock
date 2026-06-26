import sql from "@/lib/db";
import { AuthenticatedUser } from "@/lib/auth-utils";
import { notifyUsers } from "@/lib/notifications";
import type { LowStockItem } from "@/lib/line-flex-templates";

export interface StockBatchItem {
  itemId: string;
  lotNo: string;
  qty: number;
  name?: string;
  expDate?: string;
}

interface AuditContext {
  userAgent: string;
  ipAddress: string;
}

const getActorName = (user: AuthenticatedUser) => {
  return user?.name ? `${user.name} (${user.role})` : "Staff";
};

async function notifyLowStockForAffectedItems(itemIds: string[]) {
  const affectedIds = new Set(itemIds.map((id) => id.toLowerCase()));
  if (affectedIds.size === 0) return;

  try {
    const lowStockRows = await sql`
      WITH InventorySummary AS (
        SELECT
          item_id,
          SUM(quantity) as current_qty
        FROM inventory
        GROUP BY item_id
      )
      SELECT
        m.item_id as "itemId",
        m.name,
        m.unit,
        m.min_threshold as "minThreshold",
        COALESCE(i.current_qty, 0) as quantity
      FROM master_data m
      LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
      WHERE COALESCE(i.current_qty, 0) <= m.min_threshold
      ORDER BY COALESCE(i.current_qty, 0) ASC, m.item_id ASC
    `;

    const affectedLowStock = (lowStockRows as unknown as LowStockItem[]).filter((item) => {
      return affectedIds.has(item.itemId.toLowerCase());
    });

    if (affectedLowStock.length === 0) return;

    const settings = await sql`
      SELECT *
      FROM notification_settings
      WHERE notify_low_stock = true
    `;

    if (settings.length > 0) {
      await notifyUsers("LOW_STOCK", affectedLowStock, settings);
    }
  } catch (error) {
    console.error("[Stock Transactions] Low stock notification failed:", error);
  }
}

export async function runReceiveBatch(
  batchItems: StockBatchItem[],
  user: AuthenticatedUser,
  audit: AuditContext
) {
  const masterData = await sql`SELECT item_id, name FROM master_data`;
  const itemNameMap: Record<string, string> = {};
  const affectedItemIds: string[] = [];
  masterData.forEach((row) => {
    itemNameMap[row.item_id.toLowerCase()] = row.name;
  });

  for (const item of batchItems) {
    const targetItemId = item.itemId.toString();
    const targetLotNo = item.lotNo.toString();
    const qty = parseFloat(String(item.qty));
    const expDate = item.expDate ? item.expDate : null;

    if (isNaN(qty) || qty <= 0) continue;

    const itemName = itemNameMap[targetItemId.toLowerCase()] || "Unknown";
    const actor = getActorName(user);

    await sql`
      WITH upserted AS (
        INSERT INTO inventory (item_id, lot_no, exp_date, quantity)
        VALUES (${targetItemId}, ${targetLotNo}, ${expDate}, ${qty})
        ON CONFLICT (item_id, lot_no)
        DO UPDATE SET
          quantity = inventory.quantity + ${qty},
          exp_date = COALESCE(EXCLUDED.exp_date, inventory.exp_date)
        RETURNING item_id, lot_no
      )
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address)
      SELECT item_id, ${itemName}, lot_no, 'รับเข้าสต๊อกหลัก', ${qty}, ${actor}, ${audit.userAgent}, ${audit.ipAddress}
      FROM upserted
    `;

    affectedItemIds.push(targetItemId);
  }

  await notifyLowStockForAffectedItems(affectedItemIds);

  return {
    success: true,
    message: `รับเข้าสำเร็จ ${batchItems.length} รายการ`,
  };
}

export async function runDispenseBatch(
  batchItems: StockBatchItem[],
  user: AuthenticatedUser,
  audit: AuditContext
) {
  const masterData = await sql`SELECT item_id, name FROM master_data`;
  const masterMap: Record<string, string> = {};
  const affectedItemIds: string[] = [];
  masterData.forEach((row) => {
    masterMap[row.item_id.toLowerCase()] = row.name;
  });

  for (const item of batchItems) {
    const targetItemId = item.itemId.toString();
    const targetLotNo = item.lotNo.toString();
    const qtyToSubtract = parseFloat(String(item.qty));

    if (isNaN(qtyToSubtract) || qtyToSubtract <= 0) continue;

    const itemName = masterMap[targetItemId.toLowerCase()] || "Unknown";
    const actor = getActorName(user);

    const result = await sql`
      WITH updated AS (
        UPDATE inventory
        SET quantity = quantity - ${qtyToSubtract}
        WHERE LOWER(item_id) = LOWER(${targetItemId})
          AND lot_no = ${targetLotNo}
          AND quantity >= ${qtyToSubtract}
        RETURNING item_id, lot_no
      )
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address)
      SELECT item_id, ${itemName}, lot_no, 'เบิกไปหน้างาน', ${qtyToSubtract}, ${actor}, ${audit.userAgent}, ${audit.ipAddress}
      FROM updated
      RETURNING id
    `;

    if (result.length === 0) {
      throw new Error(`เบิกไม่สำเร็จ: ${item.name || targetItemId} (Lot: ${item.lotNo}) มียอดไม่พอหรือถูกเบิกไปก่อนหน้าแล้ว`);
    }

    affectedItemIds.push(targetItemId);
  }

  await notifyLowStockForAffectedItems(affectedItemIds);

  return {
    success: true,
    message: "เบิกจ่ายสำเร็จ",
  };
}
