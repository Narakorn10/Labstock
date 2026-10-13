import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { andDept, andDeptWrite, deptInsert, departmentErrorResponse, getDepartmentScope, type DepartmentScope } from "@/lib/scoped-db";
import { getRequestId, withRequestId } from "@/lib/request-observability";

// Category lists (reagent / job / machine types). The name is globally unique and master_data points at it by name, so in
// a room the list is the room's own rows PLUS every name its items already use (a name created by another room and
// reused here would otherwise be missing from the list). Legacy / "all rooms": the original query.
const TYPE_COLUMN = { reagent_types: "reagent_type", job_types: "job_type", machine_types: "machine_type" } as const;
type TypeTable = keyof typeof TYPE_COLUMN;

function typeNames(table: TypeTable, scope: DepartmentScope) {
  const tableRef = sql.unsafe(table);
  if (scope.mode !== "one") return sql`SELECT name FROM ${tableRef} ORDER BY name ASC`;
  const columnRef = sql.unsafe(TYPE_COLUMN[table]);
  return sql`
    SELECT name FROM ${tableRef} WHERE TRUE${andDept(scope)}
    UNION
    SELECT ${columnRef} AS name FROM master_data WHERE COALESCE(${columnRef}, '') <> ''${andDept(scope)}
    ORDER BY name ASC
  `;
}

async function loadDepartments(): Promise<string[]> {
  try {
    const rows = await sql`SELECT name FROM departments ORDER BY name ASC`;
    return rows.map((row) => row.name as string);
  } catch (error: unknown) {
    // Table is created by upgrade_v29_departments.sql; until then Settings keeps working without it.
    console.warn("[Settings GET] departments unavailable", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return withRequestId(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), requestId);
    }
    if (user.role === "Vendor" && !user.vendor) {
      return withRequestId(
        NextResponse.json({ error: "Vendor profile is not configured" }, { status: 403 }),
        requestId,
      );
    }

    const scope = await getDepartmentScope(user);
    const [reagentRows, jobRows, machineRows, unitRows, vendorRows, departments] = await Promise.all([
      typeNames("reagent_types", scope),
      typeNames("job_types", scope),
      typeNames("machine_types", scope),
      sql`
        SELECT DISTINCT unit AS name
        FROM master_data
        WHERE COALESCE(unit, '') <> ''${andDept(scope)}
        ORDER BY unit ASC
      `,
      user.role === "Vendor"
        ? sql`
            SELECT DISTINCT vendor AS name
            FROM master_data
            WHERE vendor = ${user.vendor}${andDept(scope)}
            ORDER BY vendor ASC
          `
        : sql`
            SELECT DISTINCT vendor AS name
            FROM master_data
            WHERE COALESCE(vendor, '') <> ''${andDept(scope)}
            ORDER BY vendor ASC
          `,
      loadDepartments(),
    ]);

    return withRequestId(
      NextResponse.json({
        reagentTypes: reagentRows.map((row) => row.name),
        jobTypes: jobRows.map((row) => row.name),
        machineTypes: machineRows.map((row) => row.name),
        units: unitRows.map((row) => row.name),
        vendors: vendorRows.map((row) => row.name),
        departments,
      }),
      requestId,
    );
  } catch (error: unknown) {
    const scoped = departmentErrorResponse(error, requestId);
    if (scoped) return scoped;
    console.error(`[Settings GET] requestId=${requestId}`, error);
    return withRequestId(
      NextResponse.json({ error: "Failed to fetch settings", requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return withRequestId(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), requestId);
    }
    if (user.role !== "Admin") {
      return withRequestId(NextResponse.json({ error: "Forbidden" }, { status: 403 }), requestId);
    }

    const body = await request.json() as { action?: unknown; type?: unknown; value?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    const type = typeof body.type === "string" ? body.type : "";
    const value = typeof body.value === "string" ? body.value.trim() : "";

    if (!value || value.length > 200) {
      return withRequestId(NextResponse.json({ error: "Invalid value" }, { status: 400 }), requestId);
    }

    const tableName = {
      reagent: "reagent_types",
      job: "job_types",
      machine: "machine_types",
      department: "departments",
    }[type];
    if (!tableName) {
      return withRequestId(NextResponse.json({ error: "Invalid type" }, { status: 400 }), requestId);
    }

    if (action === "add") {
      if (tableName === "departments") {
        await sql`INSERT INTO departments (name) VALUES (${value}) ON CONFLICT (name) DO NOTHING`;
      } else {
        // The room is only worked out for the category lists: adding a department itself is not room-scoped, so an
        // Admin viewing "all rooms" can still add and remove departments.
        const scope = await getDepartmentScope(user);
        const { column, value: roomValue } = deptInsert(scope);
        const table = sql.unsafe(tableName);
        if (scope.mode === "legacy") {
          await sql`INSERT INTO ${table} (name) VALUES (${value}) ON CONFLICT (name) DO NOTHING`;
        } else {
          const inserted = await sql`INSERT INTO ${table} (name${column}) VALUES (${value}${roomValue}) ON CONFLICT (name) DO NOTHING RETURNING name`;
          if (inserted.length === 0) {
            // The name is globally unique: it already exists, in this room (fine) or in another room (say so).
            const own = await sql`SELECT 1 FROM ${table} WHERE name = ${value}${andDept(scope)} LIMIT 1`;
            if (own.length === 0) {
              return withRequestId(
                NextResponse.json({ error: "ชื่อนี้มีอยู่แล้วในห้องอื่น กรุณาใช้ชื่ออื่น หรือเลือกใช้ชื่อเดิมจากรายการของรายการน้ำยา" }, { status: 409 }),
                requestId,
              );
            }
          }
        }
      }

      return withRequestId(NextResponse.json({ success: true, message: "เพิ่มข้อมูลสำเร็จ" }), requestId);
    }

    if (action === "delete") {
      if (tableName === "departments") {
        await sql`DELETE FROM departments WHERE name = ${value}`;
      } else {
        const scope = await getDepartmentScope(user);
        const table = sql.unsafe(tableName);
        try {
          await sql`DELETE FROM ${table} WHERE name = ${value}${andDeptWrite(scope)}`;
        } catch (error: unknown) {
          // master_data points at the name: a category that some item (of any room) still uses cannot be removed.
          if (scope.mode !== "legacy" && (error as { code?: string }).code === "23503") {
            return withRequestId(NextResponse.json({ error: "ประเภทนี้ยังถูกใช้งานอยู่ จึงลบไม่ได้" }, { status: 409 }), requestId);
          }
          throw error;
        }
      }

      return withRequestId(NextResponse.json({ success: true, message: "ลบข้อมูลสำเร็จ" }), requestId);
    }

    return withRequestId(NextResponse.json({ error: "Invalid action" }, { status: 400 }), requestId);
  } catch (error: unknown) {
    const scoped = departmentErrorResponse(error, requestId);
    if (scoped) return scoped;
    console.error(`[Settings POST] requestId=${requestId}`, error);
    return withRequestId(
      NextResponse.json({ error: "Failed to update settings", requestId }, { status: 500 }),
      requestId,
    );
  }
}
