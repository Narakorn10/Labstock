import sql from "@/lib/db";

// Small helpers for the department-aware notification crons (expiring-soon, vendor-low-stock, weekly-stock-summary).
// They are only used when the scope is NOT legacy; with departments off the routes run their original code.
//
// Policy: every non-Vendor recipient (staff, Manager, Admin alike) receives only the items of departments they are a
// member of (user_departments), one message per department. A non-Vendor with no membership row receives nothing
// (fail closed). Vendors are handled separately by the routes (temporarily across departments, docs/departments-rollout.md).

type SqlFragment = ReturnType<typeof sql>;

/** A department id read from the driver (number or numeric string): a positive integer, otherwise null. */
export function positiveDepartmentId(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Groups rows by their department id; rows without a valid one are left out (they reach no staff member). */
export function groupByDepartment<T extends { departmentId?: unknown }>(rows: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const id = positiveDepartmentId(row.departmentId);
    if (id === null) continue;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return groups;
}

// The fragments below are appended to a recipient query that aliases notification_settings as n and users as u.

/** Non-Vendor recipients who are members of the department. */
export function staffOfDepartment(departmentId: number): SqlFragment {
  return sql` AND COALESCE(u.role, '') <> 'Vendor' AND EXISTS (SELECT 1 FROM user_departments ud WHERE ud.username = n.username AND ud.department_id = ${departmentId})`;
}

/** Non-Vendor recipients with no department membership at all (they are skipped; only their number is logged). */
export function staffWithoutDepartment(): SqlFragment {
  return sql` AND COALESCE(u.role, '') <> 'Vendor' AND NOT EXISTS (SELECT 1 FROM user_departments ud WHERE ud.username = n.username)`;
}
