import sql from "@/lib/db";
import { effectiveRole } from "@/lib/department-context";
import { departmentsReady, isMissingDepartmentSchemaError, markDepartmentsNotReady } from "@/lib/departments-flag";

// Validation for "switch the working department" (design section 3).
//
// SECURITY BOUNDARY: the Auth.js jwt callback runs this on every trigger "update", and a browser can call
// useSession().update(anything) against the same endpoint as our own route. So nothing the client sends is trusted:
// the requested department is re-checked against the database here, and only that one field is ever read.

const MAX_INT4 = 2_147_483_647;

export type DepartmentSwitchTarget = {
  /** The value to store in the token: a department id, or "ALL". */
  activeDepartmentId: number | "ALL";
  department: { id: number | null; name: string; code: string; role: string };
  scope: number | "ALL";
};

/** Accepts a positive int4 number or the string "ALL". Anything else (strings of digits, floats, objects) is invalid. */
export function parseRequestedDepartment(value: unknown): number | "ALL" | null {
  if (value === "ALL") return "ALL";
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_INT4) return value;
  return null;
}

/**
 * Returns the validated target, or null when the user may not switch to it:
 * unknown/inactive user, Vendor (locked to its own department), department missing/inactive,
 * not a member (global Admin may enter any active department), or "ALL" for a non-Admin.
 * Never call when departmentsReady() is false. Throws on database errors.
 */
export async function validateDepartmentSwitch(username: unknown, requested: unknown): Promise<DepartmentSwitchTarget | null> {
  if (typeof username !== "string" || username === "") return null;
  const target = parseRequestedDepartment(requested);
  if (target === null) return null;

  const requestedId = target === "ALL" ? null : target;
  const rows = (await sql`
    SELECT u.role AS global_role, d.id AS department_id, d.name AS department_name, d.code AS department_code,
           ud.role AS member_role, (ud.username IS NOT NULL) AS is_member
    FROM users u
    LEFT JOIN departments d ON d.id = ${requestedId} AND d.is_active
    LEFT JOIN user_departments ud ON ud.department_id = d.id AND ud.username = u.username
    WHERE u.username = ${username} AND u.account_status = 'active'
    LIMIT 1
  `) as Array<{
    global_role: string;
    department_id: number | null;
    department_name: string | null;
    department_code: string | null;
    member_role: string | null;
    is_member: boolean | null;
  }>;

  const row = rows[0];
  if (!row) return null;
  const globalRole = String(row.global_role);
  if (globalRole === "Vendor") return null;
  const isAdmin = globalRole === "Admin";

  if (target === "ALL") {
    if (!isAdmin) return null;
    return {
      activeDepartmentId: "ALL",
      department: { id: null, name: "ทุกงาน", code: "ALL", role: "Admin" },
      scope: "ALL",
    };
  }

  if (row.department_id === null || row.department_code === null) return null;
  if (!isAdmin && row.is_member !== true) return null;
  return {
    activeDepartmentId: target,
    department: {
      id: row.department_id,
      name: row.department_name ?? row.department_code,
      code: row.department_code,
      role: effectiveRole(globalRole, row.member_role) ?? globalRole,
    },
    scope: target,
  };
}

/**
 * jwt callback, trigger "update". Returns the token with activeDepartmentId set ONLY when everything checks out;
 * in every other case (flag off, bad payload, forged id, database error) the same token object is returned unchanged.
 * With DEPARTMENTS_ENABLED unset this makes no sql call at all.
 */
export async function applyActiveDepartmentUpdate<T extends object>(token: T, session: unknown): Promise<T> {
  try {
    if (!await departmentsReady()) return token;
    // Only this one field is read from the client-supplied object.
    const requested = typeof session === "object" && session !== null
      ? (session as { activeDepartmentId?: unknown }).activeDepartmentId
      : undefined;
    const target = await validateDepartmentSwitch((token as { username?: unknown }).username, requested);
    if (target) (token as { activeDepartmentId?: unknown }).activeDepartmentId = target.activeDepartmentId;
  } catch (error) {
    if (isMissingDepartmentSchemaError(error)) {
      markDepartmentsNotReady(`department switch failed (${(error as { code?: string }).code}); using legacy path`);
    } else {
      console.error("Department switch failed:", error);
    }
  }
  return token;
}
