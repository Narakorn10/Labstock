import sql from "@/lib/db";
import { andDept, type DepartmentScope } from "@/lib/scoped-db";

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

// Every query takes a REQUIRED scope. The runtime check guards the slot against a wrong argument (a string, undefined...)
// landing there: andDept() treats any non-"one" mode as "no filter", which would fail open.
function assertScope(scope: DepartmentScope | undefined): asserts scope is DepartmentScope {
  const mode = (scope as { mode?: unknown } | undefined)?.mode;
  if (mode !== "legacy" && mode !== "one" && mode !== "all") {
    throw new Error("Bot stock queries require a DepartmentScope");
  }
}

// WHERE for a statement that has none yet (inventory CTE, logs): legacy and "all" -> empty (SQL text unchanged), one -> filter.
// andDept() only appends AND to an existing WHERE, so these two need their own fragment.
function whereDept(scope: DepartmentScope) {
  return scope.mode === "one" ? sql` WHERE department_id = ${scope.departmentId}` : sql``;
}

export async function getRecentLogRows(limit: number, scope: DepartmentScope) {
  assertScope(scope);
  return await sql`
    SELECT
      timestamp,
      action,
      item_id as "itemId",
      name,
      lot_no as "lotNo",
      quantity as qty,
      username as user
    FROM logs${whereDept(scope)}
    ORDER BY timestamp DESC, id DESC
    LIMIT ${limit}
  ` as BotLogRow[];
}

export async function getLowStockRows(limit = 10, scope: DepartmentScope) {
  assertScope(scope);
  return await sql`
    WITH InventorySummary AS (
      SELECT
        item_id,
        SUM(quantity) as current_qty
      FROM inventory${whereDept(scope)}
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
    WHERE COALESCE(i.current_qty, 0) <= m.min_threshold${andDept(scope, "m")}
    ORDER BY COALESCE(i.current_qty, 0) ASC, m.item_id ASC
    LIMIT ${limit}
  ` as BotStockRow[];
}

export async function searchStockRows(keyword: string, limit = 10, scope: DepartmentScope) {
  assertScope(scope);
  const likeKeyword = `%${keyword}%`;

  // The OR must be wrapped before the department filter is added, otherwise AND binds to the last OR term only (a barcode
  // match would leak another department). Legacy keeps the original statement byte for byte.
  if (scope.mode === "one") {
    return await sql`
    WITH InventorySummary AS (
      SELECT
        item_id,
        SUM(quantity) as current_qty
      FROM inventory${whereDept(scope)}
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
    WHERE (m.item_id ILIKE ${likeKeyword}
       OR m.name ILIKE ${likeKeyword}
       OR COALESCE(m.barcode, '') ILIKE ${likeKeyword})${andDept(scope, "m")}
    ORDER BY m.item_id ASC
    LIMIT ${limit}
  ` as BotStockRow[];
  }

  return await sql`
    WITH InventorySummary AS (
      SELECT
        item_id,
        SUM(quantity) as current_qty
      FROM inventory${whereDept(scope)}
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

export async function searchStockRowsByJob(jobKeyword: string, scope: DepartmentScope) {
  assertScope(scope);
  const likeKeyword = `%${jobKeyword}%`;

  return await sql`
    WITH InventorySummary AS (
      SELECT
        item_id,
        SUM(quantity) as current_qty
      FROM inventory${whereDept(scope)}
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
    WHERE COALESCE(m.job_type, '') ILIKE ${likeKeyword}${andDept(scope, "m")}
    ORDER BY m.name ASC, m.item_id ASC
  ` as BotStockRow[];
}
