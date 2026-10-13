import sql from "@/lib/db";
import type { AuthenticatedUser } from "@/lib/auth-utils";
import { departmentsReady, isMissingDepartmentSchemaError } from "@/lib/departments-flag";

// Room admin ("ผู้ดูแลห้อง"): a user holding user_departments.admin_slot (1 or 2) in a department (migration v35).
// A room admin may change settings of THEIR OWN room only. It is deliberately NOT a role: effectiveRole() and
// resolveUserDepartment() are untouched, so nobody's existing permissions change. The slot is read with a fresh query
// on every check (no cache, no token claim), so removing or suspending a room admin takes effect immediately.
//
// The department always comes from the authenticated scope (user.scope), never from the request body or URL.

/**
 * True when `user` currently holds an admin slot in `departmentId`.
 * Requires: departments enabled and ready, active account, not a Vendor, department active and with a code.
 * Flag off: false with zero SQL calls. Schema not there yet (42703 / 42P01, e.g. v35 not applied): false.
 * Other database errors are thrown (never turn a database failure into a silent "no").
 */
export async function hasRoomAdminSlot(user: Pick<AuthenticatedUser, "username">, departmentId: number): Promise<boolean> {
  if (!Number.isInteger(departmentId) || departmentId < 1) return false;
  if (!(await departmentsReady())) return false;
  try {
    const rows = await sql`
      SELECT 1 AS ok
      FROM user_departments ud
      JOIN users u ON u.username = ud.username
      JOIN departments d ON d.id = ud.department_id
      WHERE ud.username = ${user.username}
        AND ud.department_id = ${departmentId}
        AND ud.admin_slot IS NOT NULL
        AND u.account_status = 'active'
        AND u.role <> 'Vendor'
        AND d.is_active
        AND d.code IS NOT NULL
      LIMIT 1
    `;
    return rows.length > 0;
  } catch (error) {
    if (isMissingDepartmentSchemaError(error)) return false;
    throw error;
  }
}

export type RoomSettingsAccess =
  | { ok: true; via: "admin" | "room-admin"; departmentId: number | null }
  | { ok: false; reason: "forbidden" | "select-department" };

/**
 * Who may change settings of the room the user is currently working in?
 *  - system Admin: yes. departmentId is the selected room, or null on the legacy path (departments off).
 *    Scope "ALL" is read-only, so a write needs a room first: reason "select-department".
 *  - room admin of the selected room: yes (departmentId = that room).
 *  - everyone else, and anyone who asked for a room they are not in (departmentDenied): "forbidden".
 * The room comes only from user.scope.
 */
export async function requireRoomSettingsAccess(user: AuthenticatedUser): Promise<RoomSettingsAccess> {
  if (user.departmentDenied) return { ok: false, reason: "forbidden" };
  const scope = user.scope;
  if (user.role === "Admin") {
    if (scope === "ALL") return { ok: false, reason: "select-department" };
    return { ok: true, via: "admin", departmentId: typeof scope === "number" ? scope : null };
  }
  if (typeof scope !== "number") return { ok: false, reason: "forbidden" };
  return (await hasRoomAdminSlot(user, scope))
    ? { ok: true, via: "room-admin", departmentId: scope }
    : { ok: false, reason: "forbidden" };
}

/**
 * Reagent / material settings (policies, master data, shelf life): Admin and Manager as before, plus the room admin of
 * the room in user.scope. The routes still scope every query by the same room, so a room admin can only touch their own room.
 */
export async function canManageRoomReagents(user: AuthenticatedUser): Promise<boolean> {
  if (user.role === "Admin" || user.role === "Manager") return true;
  return (await requireRoomSettingsAccess(user)).ok;
}
