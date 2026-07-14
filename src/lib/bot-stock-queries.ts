import sql from "@/lib/db";

export type BotStockRow = {
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  minThreshold?: number;
  jobType?: string;
  machineType?: string;
};

export type BotLogRow = {
  timestamp: string;
  action: string;
  itemId: string;
  name: string;
  lotNo: string;
  qty: number;
  user: string;
};

export async function getRecentLogRows(limit: number) {
  return await sql`
    SELECT
      timestamp,
      action,
      item_id as "itemId",
      name,
      lot_no as "lotNo",
      quantity as qty,
      username as user
    FROM logs
    ORDER BY timestamp DESC, id DESC
    LIMIT ${limit}
  ` as BotLogRow[];
}

export async function getLowStockRows(limit = 10) {
  return await sql`
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
    LIMIT ${limit}
  ` as BotStockRow[];
}

export async function searchStockRows(keyword: string, limit = 10) {
  const likeKeyword = `%${keyword}%`;

  return await sql`
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
      COALESCE(NULLIF(m.job_type, ''), 'Unassigned job') as "jobType",
      COALESCE(NULLIF(m.machine_type, ''), 'Unassigned machine') as "machineType",
      m.unit,
      m.min_threshold as "minThreshold",
      COALESCE(i.current_qty, 0) as quantity
    FROM master_data m
    LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
    WHERE m.item_id ILIKE ${likeKeyword}
       OR m.name ILIKE ${likeKeyword}
       OR COALESCE(m.barcode, '') ILIKE ${likeKeyword}
    ORDER BY m.item_id ASC
    LIMIT ${limit}
  ` as BotStockRow[];
}

export async function searchStockRowsByJob(jobKeyword: string) {
  const likeKeyword = `%${jobKeyword}%`;

  return await sql`
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
      COALESCE(NULLIF(m.job_type, ''), 'Unassigned job') as "jobType",
      COALESCE(NULLIF(m.machine_type, ''), 'Unassigned machine') as "machineType",
      m.unit,
      m.min_threshold as "minThreshold",
      COALESCE(i.current_qty, 0) as quantity
    FROM master_data m
    LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
    WHERE COALESCE(m.job_type, '') ILIKE ${likeKeyword}
    ORDER BY m.name ASC, m.item_id ASC
  ` as BotStockRow[];
}
