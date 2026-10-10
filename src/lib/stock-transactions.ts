import sql from "@/lib/db";
import { AuthenticatedUser } from "@/lib/auth-utils";
import { AppError } from "@/lib/errors";
import { andDept, andDeptWrite, deptInsert, deptWhere, writeDepartmentId, type DepartmentScope } from "@/lib/scoped-db";
import { notifyUsers, notifyUsersVendorScoped } from "@/lib/notifications";
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

// Who may receive LOW_STOCK for an item of this department. Legacy: empty fragment, so the recipient SQL is unchanged.
// One department: members of that department (user_departments) plus Vendors. A Vendor needs no membership row because
// notifyUsersVendorScoped only gives each Vendor the items of their own vendor name (vendor-notification-scope.ts).
function recipientDepartmentFilter(scope: DepartmentScope) {
  if (scope.mode !== "one") return sql``;
  return sql` AND (u.role = 'Vendor' OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.username = n.username AND ud.department_id = ${scope.departmentId}))`;
}

async function notifyLowStockForAffectedItems(itemIds: string[], scope: DepartmentScope) {
  const affectedIds = new Set(itemIds.map((id) => id.toLowerCase()));
  if (affectedIds.size === 0) return;

  // Only "one" adds a filter (mode "all" never gets here: the callers throw before writing).
  const inventoryWhere = scope.mode === "one" ? sql`WHERE ${deptWhere(scope)}` : sql``;
  try {
    const lowStockRows = await sql`
      WITH InventorySummary AS (
        SELECT
          item_id,
          SUM(quantity) as current_qty
        FROM inventory
        ${inventoryWhere}
        GROUP BY item_id
      )
      SELECT
        m.item_id as "itemId",
        m.name,
        m.unit,
        m.min_threshold as "minThreshold",
        COALESCE(m.vendor, '') as vendor,
        COALESCE(i.current_qty, 0) as quantity
      FROM master_data m
      LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
      WHERE m.is_active = TRUE${andDept(scope, "m")}
        AND COALESCE(i.current_qty, 0) <= m.min_threshold
      ORDER BY COALESCE(i.current_qty, 0) ASC, m.item_id ASC
    `;

    const affectedLowStock = (lowStockRows as unknown as LowStockItem[]).filter((item) => {
      return affectedIds.has(item.itemId.toLowerCase());
    });

    if (affectedLowStock.length === 0) return;

    const settingsRows = await sql`
      SELECT n.*, u.role, u.vendor
      FROM notification_settings n
      JOIN users u ON u.username = n.username
      WHERE n.notify_low_stock = true${recipientDepartmentFilter(scope)}
    `;

    if (settingsRows.length > 0) {
      await notifyUsersVendorScoped("LOW_STOCK", affectedLowStock, settingsRows);
    }
  } catch (error) {
    console.error("[Stock Transactions] Low stock notification failed:", error);
  }
}

export async function runReceiveBatch(
  batchItems: StockBatchItem[],
  user: AuthenticatedUser,
  audit: AuditContext,
  scope: DepartmentScope
) {
  // Mode "all" (viewing every department) cannot write: throws DEPARTMENT_READ_ONLY before any SQL runs.
  writeDepartmentId(scope);
  const d = deptInsert(scope);
  const masterData = await sql`SELECT item_id, name, is_active FROM master_data WHERE ${deptWhere(scope)}`;
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

  // Departments on: an item outside the user's department (or one that does not exist) looks the same to them.
  if (scope.mode === "one") {
    const foreign = validItems.find((item) => !Object.prototype.hasOwnProperty.call(activeMap, item.itemId.toLowerCase()));
    if (foreign) {
      throw new AppError("ITEM_NOT_IN_DEPARTMENT", { message: `รายการนี้ไม่อยู่ในงานของคุณ (${foreign.itemId})`, detail: `ITEM_NOT_IN_DEPARTMENT: ${foreign.itemId}` });
    }
  }

  const inactive = validItems.find((item) => activeMap[item.itemId.toLowerCase()] === false);
  if (inactive) {
    const name = itemNameMap[inactive.itemId.toLowerCase()];
    const label = name ? `${name} (${inactive.itemId})` : inactive.itemId;
    throw new AppError("REAGENT_INACTIVE", { message: `สารเคมีรายการนี้ถูกปิดใช้งานแล้ว (${label})`, detail: `REAGENT_INACTIVE: ${inactive.itemId}` });
  }
  if (validItems.length === 0) {
    return { success: true, message: 'ไม่มีรายการที่ต้องรับเข้า' };
  }

  const actor = getActorName(user);
  await sql.transaction((transaction) => validItems.flatMap((item) => [
    transaction`
      SELECT labstock_assert(EXISTS (
        SELECT 1 FROM master_data
        WHERE LOWER(item_id) = LOWER(${item.itemId}) AND is_active = TRUE${andDeptWrite(scope)}
        FOR UPDATE
      ), 'REAGENT_INACTIVE: ' || ${item.itemId}) AS ok
    `,
    // The upsert below conflicts on (item_id, lot_no, received_on). If that exact row belongs to another department
    // (inconsistent data) it must not be added to or relabelled, so refuse before touching it.
    ...(scope.mode === "one" ? [transaction`
      SELECT labstock_assert(NOT EXISTS (
        SELECT 1 FROM inventory
        WHERE item_id = ${item.itemId} AND lot_no = ${item.lotNo} AND received_on = CURRENT_DATE
          AND department_id <> ${scope.departmentId}
      ), 'ITEM_NOT_IN_DEPARTMENT: ' || ${item.itemId}) AS ok
    `] : []),
    transaction`
      WITH upserted AS (
        INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on${d.column})
        VALUES (${item.itemId}, ${item.lotNo}, ${item.expDate}, ${item.qty}, CURRENT_DATE${d.value})
        ON CONFLICT (item_id, lot_no, received_on)
        DO UPDATE SET
          quantity = inventory.quantity + ${item.qty},
          exp_date = COALESCE(EXCLUDED.exp_date, inventory.exp_date)
        RETURNING id, item_id, lot_no, received_on
      )
      INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address${d.column})
      SELECT item_id, ${itemNameMap[item.itemId.toLowerCase()] || 'Unknown'}, lot_no, 'รับเข้าสต๊อกหลัก', ${item.qty}, ${actor}, ${audit.userAgent}, ${audit.ipAddress}${d.value}
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

  await notifyLowStockForAffectedItems(affectedItemIds, scope);

  return {
    success: true,
    message: `รับเข้าสำเร็จ ${validItems.length} รายการ`,
  };
}

export async function runDispenseBatch(
  batchItems: StockBatchItem[],
  user: AuthenticatedUser,
  audit: AuditContext,
  scope: DepartmentScope
) {
  // Mode "all" (viewing every department) cannot write: throws DEPARTMENT_READ_ONLY before any SQL runs.
  writeDepartmentId(scope);
  const masterData = await sql`SELECT item_id, name, is_active FROM master_data WHERE ${deptWhere(scope)}`;
  const masterMap: Record<string, string> = {};
  const activeMap: Record<string, boolean> = {};
  const affectedItemIds: string[] = [];
  masterData.forEach((row) => {
    masterMap[row.item_id.toLowerCase()] = row.name;
    activeMap[row.item_id.toLowerCase()] = row.is_active !== false;
  });

  // One lot can sit in several inventory rows (one per receive day). The chosen row is used first;
  // if it cannot cover the quantity the rest comes from the other rounds of the same lot, oldest expiry first.
  const preparedItems: Array<StockBatchItem & { targetItemId: string; targetLotNo: string; qtyToSubtract: number; allocations: Array<{ inventoryId: number; qty: number }> }> = [];
  const reservedInBatch = new Map<number, number>();
  for (const item of batchItems) {
    const chosenInventoryId = Number(item.inventoryId);
    const preferredId = Number.isInteger(chosenInventoryId) && chosenInventoryId > 0 ? chosenInventoryId : 0;
    const targetItemId = item.itemId.toString();
    const targetLotNo = item.lotNo.toString();
    const qtyToSubtract = parseFloat(String(item.qty));

    if (Number.isNaN(qtyToSubtract) || qtyToSubtract <= 0) continue;
    // Departments on: an item outside the user's department (or one that does not exist) looks the same to them.
    if (scope.mode === "one" && !Object.prototype.hasOwnProperty.call(activeMap, targetItemId.toLowerCase())) {
      throw new AppError("ITEM_NOT_IN_DEPARTMENT", { message: `รายการนี้ไม่อยู่ในงานของคุณ (${targetItemId})`, detail: `ITEM_NOT_IN_DEPARTMENT: ${targetItemId}` });
    }
    if (activeMap[targetItemId.toLowerCase()] === false) {
      const name = masterMap[targetItemId.toLowerCase()];
      const label = name ? `${name} (${targetItemId})` : targetItemId;
      throw new AppError("REAGENT_INACTIVE", { message: `สารเคมีรายการนี้ถูกปิดใช้งานแล้ว (${label})`, detail: `REAGENT_INACTIVE: ${targetItemId}` });
    }

    const candidateRows = await sql`
      SELECT id, quantity
      FROM inventory
      WHERE LOWER(item_id) = LOWER(${targetItemId})
        AND quantity > 0${andDept(scope)}
        AND lot_no = COALESCE(
          (SELECT lot_no FROM inventory WHERE id = ${preferredId} AND LOWER(item_id) = LOWER(${targetItemId})${andDept(scope)}),
          ${targetLotNo}
        )
      ORDER BY (id = ${preferredId}) DESC, exp_date ASC NULLS LAST, received_on ASC, id ASC
    `;

    if (candidateRows.length === 0) {
      const text = `เบิกไม่สำเร็จ: ${item.name || targetItemId} (Lot: ${item.lotNo}) ไม่พบรอบรับเข้าที่พร้อมใช้งาน`;
      throw new AppError("LOT_NOT_AVAILABLE", { message: text, detail: text });
    }

    const allocations: Array<{ inventoryId: number; qty: number }> = [];
    let remaining = qtyToSubtract;
    for (const row of candidateRows) {
      if (remaining <= 1e-9) break;
      const rowId = Number(row.id);
      const available = Number(row.quantity) - (reservedInBatch.get(rowId) || 0);
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      allocations.push({ inventoryId: rowId, qty: take });
      reservedInBatch.set(rowId, (reservedInBatch.get(rowId) || 0) + take);
      remaining -= take;
    }
    if (remaining > 1e-9) {
      const name = masterMap[targetItemId.toLowerCase()];
      const label = name ? `${name} (${targetItemId})` : targetItemId;
      throw new AppError("REAGENT_STOCK_INSUFFICIENT", { message: `จำนวนคงเหลือไม่พอสำหรับรายการที่เบิก (${label})`, detail: `REAGENT_STOCK_INSUFFICIENT: ${targetItemId}` });
    }
    preparedItems.push({ ...item, targetItemId, targetLotNo, qtyToSubtract, allocations });
  }

  if (preparedItems.length === 0) {
    return { success: true, message: 'ไม่มีรายการที่ต้องเบิกจ่าย' };
  }

  const actor = getActorName(user);
  const d = deptInsert(scope);
  await sql.transaction((transaction) => preparedItems.flatMap((item) => [
    transaction`
      SELECT labstock_assert(EXISTS (
        SELECT 1 FROM master_data
        WHERE LOWER(item_id) = LOWER(${item.targetItemId}) AND is_active = TRUE${andDeptWrite(scope)}
        FOR UPDATE
      ), 'REAGENT_INACTIVE: ' || ${item.targetItemId}) AS ok
    `,
    ...item.allocations.flatMap((allocation) => [
      transaction`
        SELECT labstock_assert(EXISTS (
          SELECT 1 FROM inventory
          WHERE id = ${allocation.inventoryId}
            AND LOWER(item_id) = LOWER(${item.targetItemId})
            AND quantity >= ${allocation.qty}${andDeptWrite(scope)}
          FOR UPDATE
        ), 'REAGENT_STOCK_INSUFFICIENT: ' || ${item.targetItemId}) AS ok
      `,
      transaction`
        WITH updated AS (
          UPDATE inventory
          SET quantity = quantity - ${allocation.qty}
          WHERE id = ${allocation.inventoryId}
            AND LOWER(item_id) = LOWER(${item.targetItemId})
            AND quantity >= ${allocation.qty}${andDeptWrite(scope)}
          RETURNING item_id, lot_no
        )
        INSERT INTO logs (item_id, name, lot_no, action, quantity, username, user_agent, ip_address${d.column})
        SELECT item_id, ${masterMap[item.targetItemId.toLowerCase()] || 'Unknown'}, lot_no, 'เบิกไปหน้างาน', ${allocation.qty}, ${actor}, ${audit.userAgent}, ${audit.ipAddress}${d.value}
        FROM updated
      `,
    ]),
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

  await notifyLowStockForAffectedItems(affectedItemIds, scope);

  return {
    success: true,
    message: "เบิกจ่ายสำเร็จ",
  };
}
