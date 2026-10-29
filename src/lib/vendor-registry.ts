import sql from "@/lib/db";
import { departmentsReady, isMissingDepartmentSchemaError, markDepartmentsNotReady } from "@/lib/departments-flag";
import { andDept } from "@/lib/scoped-db";

// Approved companies (vendors) for self-registration, across ALL usable rooms.
//
// Deliberate (owner decision, 2026-10-29): sign-up lists and accepts the approved companies of every usable room, so the
// reads below use andDept({ mode: "all" }) (an empty fragment) as a visible marker instead of a room filter.
// A usable room = departments.is_active AND departments.code IS NOT NULL (same rule as listSelectableRooms).
//
// Departments off (flag off, migrations not applied, or the schema turns out to be missing) -> the legacy statements,
// which do not mention department_id, departments or user_departments.

export type ApprovedVendor = { name: string; departmentId: number | null };

const ALL_ROOMS = { mode: "all" } as const;

async function legacyList(): Promise<string[]> {
  const rows = await sql`
    SELECT name
    FROM vendors
    WHERE is_approved = TRUE
    ORDER BY name ASC
  `;
  return rows.map((row) => String(row.name));
}

async function legacyFind(name: string): Promise<ApprovedVendor | null> {
  const rows = await sql`
    SELECT name
    FROM vendors
    WHERE LOWER(name) = LOWER(${name})
      AND is_approved = TRUE
    LIMIT 1
  `;
  return rows.length === 0 ? null : { name: String(rows[0].name), departmentId: null };
}

/** Each exact spelling once, sorted by name. Case-only spellings in different rooms are separate entries. */
export async function listApprovedVendorNames(): Promise<string[]> {
  if (!await departmentsReady()) return legacyList();
  try {
    const rows = await sql`
      SELECT DISTINCT v.name
      FROM vendors v
      JOIN departments d ON d.id = v.department_id
      WHERE v.is_approved = TRUE
        AND d.is_active
        AND d.code IS NOT NULL${andDept(ALL_ROOMS, "v")}
      ORDER BY v.name ASC
    `;
    return rows.map((row) => String(row.name));
  } catch (error) {
    if (!isMissingDepartmentSchemaError(error)) throw error;
    markDepartmentsNotReady("vendor registry list failed; using legacy path");
    return legacyList();
  }
}

/**
 * Case-insensitive match. Several rows can match (case-only spellings, or the same name in two rooms once the unique
 * name is relaxed): the exact spelling asked for wins, then the room coded 'CC', then the lowest room id, then the lowest
 * vendor id. departmentId is null on the legacy path.
 */
export async function findApprovedVendor(name: string): Promise<ApprovedVendor | null> {
  if (!await departmentsReady()) return legacyFind(name);
  try {
    const rows = await sql`
      SELECT v.name, v.department_id
      FROM vendors v
      JOIN departments d ON d.id = v.department_id
      WHERE v.is_approved = TRUE
        AND d.is_active
        AND d.code IS NOT NULL${andDept(ALL_ROOMS, "v")}
        AND LOWER(v.name) = LOWER(${name})
      ORDER BY (v.name = ${name}) DESC, (d.code = 'CC') DESC, v.department_id ASC, v.id ASC
      LIMIT 1
    `;
    return rows.length === 0 ? null : { name: String(rows[0].name), departmentId: Number(rows[0].department_id) };
  } catch (error) {
    if (!isMissingDepartmentSchemaError(error)) throw error;
    markDepartmentsNotReady("vendor registry lookup failed; using legacy path");
    return legacyFind(name);
  }
}
