import sql from "@/lib/db";
import { AuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, notifyUsers } from "@/lib/notifications";
import type { LowStockItem } from "@/lib/line-flex-templates";

export interface StockBatchItem {
  inventoryId?: number;
  itemId: string;
  lotNo: string;
  qty: number;
  name?: string;
  expDate?: string;
  receivedOn?: string;
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
      WHERE m.is_active = TRUE
        AND COALESCE(i.current_qty, 0) <= m.min_threshold
      ORDER BY COALESCE(i.current_qty, 0) ASC, m.item_id ASC
    `;

    const affectedLowStock = (lowStockRows as unknown as LowStockItem[]).filter((item) => {
      return affectedIds.has(item.itemId.toLowerCase());
    });

    if (affectedLowStock.length === 0) return;

    const settingsRows = await sql`
      SELECT *
      FROM notification_settings
      WHERE notify_low_stock = true
    `;

    const settings = normalizeNotificationSettings(settingsRows);

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
  const masterData = await sql`SELECT item_id, name, is_active FROM master_data`;
  const itemNameMap: Record<string, string> = {};
  const activeMap: Record<string, boolean> = {};
  const affectedItemIds: string[] = [];
  masterData.forEach((row) => {
    itemNameMap[row.item_id.toLowerCase()] = row.name;
    activeMap[row.item_id.toLowerCase()] = row.is_active !== false;
  });

  const validItems = batchItems
    .map((item) => ({
      ...item,
      itemId: item.itemId.toString(),
      lotNo: item.lotNo.toString(),
      qty: parseFloat(String(item.qty)),
      expDate: item.expDate ? item.expDate : null,
    }))
    .filter((item) => !Number.isNaN(item.qty) && item.qty > 0);

  const inactive = validItems.find((item) => activeMap[item.itemId.toLowerCase()] === false);
  if (inactive) throw new Error(`REAGENT_INACTIVE: ${inactive.itemId}`);
  if (validItems.length === 0) {
    return { success: true, message: 'ไม่มีรายการที่ต้องรับเข้า' };
  }

  const actor = getActorName(user);
  await sql.transaction((transaction) => validItems.flatMap((item) => [
    transaction`
      SELECT labstock_assert(EXISTS (
        SELECT 1 FROM master_data
        WHERE LOWER(item_id) = LOWER(${item.itemId}) AND is_active = TRUE
        FOR UPDATE
      ), 'REAGENT_INACTIVE: ' || ${item.itemId}) AS ok
    `,
    transaction`
      WITH upserted AS (
        INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on)
        VALUES (${item.itemId}, ${item.lotNo}, ${item.expDate}, ${item.qty}, CURRENT_DATE)
        ON CONFLICT (item_id, lot_no, received_on)
        DO UPDATE SET
          quantity = inventory.quantity + ${item.qty},
          exp_date = COALESCE(EXCLUDED.exp_date, inventory.exp_date)
        RETURNING id, item_id, lot_no, received_on
      )
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address)
      SELECT item_id, ${itemNameMap[item.itemId.toLowerCase()] || 'Unknown'}, lot_no, 'รับเข้าสต๊อกหลัก', ${item.qty}, ${actor}, ${audit.userAgent}, ${audit.ipAddress}
      FROM upserted
    `,
  ]));
  validItems.forEach((item) => affectedItemIds.push(item.itemId));

  const completedItems = batchItems
    .map((item) => ({
      itemId: item.itemId.toString(),
      lotNo: item.lotNo.toString(),
      qty: parseFloat(String(item.qty)),
      name: item.name || itemNameMap[item.itemId.toString().toLowerCase()] || "Unknown",
    }))
    .filter((item) => !isNaN(item.qty) && item.qty > 0);

  if (completedItems.length > 0) {
    await notifyUsers(
      "STOCK_RECEIVED",
      {
        actor: getActorName(user),
      items: completedItems,
      },
      []
    );
  }

  await notifyLowStockForAffectedItems(affectedItemIds);

  return {
    success: true,
    message: `รับเข้าสำเร็จ ${validItems.length} รายการ`,
  };
}

export async function runDispenseBatch(
  batchItems: StockBatchItem[],
  user: AuthenticatedUser,
  audit: AuditContext
) {
  const masterData = await sql`SELECT item_id, name, is_active FROM master_data`;
  const masterMap: Record<string, string> = {};
  const activeMap: Record<string, boolean> = {};
  const affectedItemIds: string[] = [];
  masterData.forEach((row) => {
    masterMap[row.item_id.toLowerCase()] = row.name;
    activeMap[row.item_id.toLowerCase()] = row.is_active !== false;
  });

  const preparedItems: Array<StockBatchItem & { targetItemId: string; targetLotNo: string; qtyToSubtract: number; inventoryId: number }> = [];
  for (const item of batchItems) {
    let inventoryId = Number(item.inventoryId);
    const targetItemId = item.itemId.toString();
    const targetLotNo = item.lotNo.toString();
    const qtyToSubtract = parseFloat(String(item.qty));

    if (Number.isNaN(qtyToSubtract) || qtyToSubtract <= 0) continue;
    if (activeMap[targetItemId.toLowerCase()] === false) {
      throw new Error(`REAGENT_INACTIVE: ${targetItemId}`);
    }

    if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
      const candidateRows = await sql`
        SELECT id
        FROM inventory
        WHERE LOWER(item_id) = LOWER(${targetItemId})
          AND lot_no = ${targetLotNo}
          AND quantity > 0
        ORDER BY exp_date ASC NULLS LAST, received_on ASC, id ASC
        LIMIT 1
      `;

      if (candidateRows.length === 0) {
        throw new Error(`เบิกไม่สำเร็จ: ${item.name || targetItemId} (Lot: ${item.lotNo}) ไม่พบรอบรับเข้าที่พร้อมใช้งาน`);
      }

      inventoryId = Number(candidateRows[0].id);
    }
    preparedItems.push({ ...item, targetItemId, targetLotNo, qtyToSubtract, inventoryId });
  }

  if (preparedItems.length === 0) {
    return { success: true, message: 'ไม่มีรายการที่ต้องเบิกจ่าย' };
  }

  const actor = getActorName(user);
  await sql.transaction((transaction) => preparedItems.flatMap((item) => [
    transaction`
      SELECT labstock_assert(EXISTS (
        SELECT 1 FROM master_data
        WHERE LOWER(item_id) = LOWER(${item.targetItemId}) AND is_active = TRUE
        FOR UPDATE
      ), 'REAGENT_INACTIVE: ' || ${item.targetItemId}) AS ok
    `,
    transaction`
      SELECT labstock_assert(EXISTS (
        SELECT 1 FROM inventory
        WHERE id = ${item.inventoryId}
          AND LOWER(item_id) = LOWER(${item.targetItemId})
          AND quantity >= ${item.qtyToSubtract}
        FOR UPDATE
      ), 'REAGENT_STOCK_INSUFFICIENT: ' || ${item.targetItemId}) AS ok
    `,
    transaction`
      WITH updated AS (
        UPDATE inventory
        SET quantity = quantity - ${item.qtyToSubtract}
        WHERE id = ${item.inventoryId}
          AND LOWER(item_id) = LOWER(${item.targetItemId})
          AND quantity >= ${item.qtyToSubtract}
        RETURNING item_id, lot_no
      )
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address)
      SELECT item_id, ${masterMap[item.targetItemId.toLowerCase()] || 'Unknown'}, lot_no, 'เบิกไปหน้างาน', ${item.qtyToSubtract}, ${actor}, ${audit.userAgent}, ${audit.ipAddress}
      FROM updated
    `,
  ]));
  preparedItems.forEach((item) => affectedItemIds.push(item.targetItemId));

  const completedItems = preparedItems
    .map((item) => ({
      itemId: item.itemId.toString(),
      lotNo: item.lotNo.toString(),
      qty: parseFloat(String(item.qty)),
      name: item.name || masterMap[item.itemId.toString().toLowerCase()] || "Unknown",
    }))
    .filter((item) => !isNaN(item.qty) && item.qty > 0);

  if (completedItems.length > 0) {
    await notifyUsers(
      "STOCK_DISPENSED",
      {
        actor: getActorName(user),
        items: completedItems,
      },
      []
    );
  }

  await notifyLowStockForAffectedItems(affectedItemIds);

  return {
    success: true,
    message: "เบิกจ่ายสำเร็จ",
  };
}
