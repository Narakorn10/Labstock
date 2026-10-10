import sql from "@/lib/db";
import type { AuthenticatedUser } from "@/lib/auth-utils";

// Resolves "who is this user, and in which department are they working" with ONE query.
// Only call this when departmentsReady() is true (migrations v30-v34 applied and DEPARTMENTS_ENABLED=true).

export type RequestedDepartment = number | "ALL" | null;

export type ResolveDepartmentQuery = {
  /** Look the user up by username + session version (Auth.js session path)... */
  username?: string;
  sessionVersion?: number;
  /** ...or by bearer token (mobile / LIFF path). Both the raw token and its sha256 are accepted, as in the legacy code. */
  token?: string;
  tokenHash?: string;
  /** Department asked for: from the JWT (explicit=false) or from the X-Department-Id header (explicit=true). null = default. */
  requested: RequestedDepartment;
  explicit: boolean;
};

const MAX_INT4 = 2_147_483_647;

type Row = {
  username: string;
  name: string | null;
  global_role: string;
  vendor: string | null;
  token_expiry: string | Date | null;
  department_id: number | null;
  code: string | null;
  member_role: string | null;
  matched: boolean | null;
  has_membership: boolean | null;
};

// A user rejected because they have no department assignment is logged once per username per process (not on every
// request), so the owner can find who needs a user_departments row. Bounded so it cannot grow forever.
const WARNED_LIMIT = 1000;
const warnedNoMembership = new Set<string>();

function warnNoMembershipOnce(username: string) {
  if (warnedNoMembership.has(username)) return;
  if (warnedNoMembership.size >= WARNED_LIMIT) warnedNoMembership.clear();
  warnedNoMembership.add(username);
  console.warn("[departments] user rejected: no department assignment (no user_departments row)", username);
}

/** Test hook: forget which usernames were already warned about. */
export function resetDepartmentContextForTests() {
  warnedNoMembership.clear();
}

/**
 * Effective role in a department. users.role is the source of truth; user_departments.role is only an explicit
 * per-department override (NULL = use users.role). A stale override can never promote or un-vendor anyone:
 *  - global Admin is always Admin; global Vendor is always Vendor;
 *  - an override of 'Admin' is never honored for a non-global-Admin.
 */
export function effectiveRole(globalRole: string | null, memberRole: string | null): string | null {
  if (globalRole === "Admin") return "Admin";
  if (globalRole === "Vendor") return "Vendor";
  if (memberRole === "Admin") return globalRole;
  return memberRole ?? globalRole;
}

/**
 * Returns the authenticated user with an effective role and department scope, or null when no active user matches
 * (unknown user, inactive account, stale session version, bad/expired token).
 *
 * Rules:
 *  - Global Admin: role is always "Admin"; may ask for "ALL" (scope "ALL", departmentId null).
 *  - Everyone else: role is the per-department override when set (never 'Admin', never for a Vendor), else users.role
 *    (see effectiveRole). "ALL" is never granted.
 *  - Vendor: the requested department is ignored; the user stays in their (single) member department.
 *  - A requested department the user is not in: from the JWT -> silently the default department;
 *    from an explicit header -> departmentDenied (routes answer 404).
 *  - No membership row at all (e.g. a user created after the v30 backfill, or whose memberships were revoked): REJECTED
 *    (null) + a warning (once per username). There is deliberately no fallback to the default department: revoking a
 *    membership must really revoke access. The exception is a global Admin, who may enter any ACTIVE department
 *    without a membership row (so an Admin can always repair memberships).
 *  - Membership rows exist but none in an ACTIVE department (department deactivated): rejected (null).
 *  - No active department resolves at all (Admin with no active department): rejected (null).
 *    A ready-path result therefore never has a null scope; null scope is reserved for the legacy path.
 *
 * Throws on database errors; the caller decides whether SQLSTATE 42P01 / 42703 means "fall back to legacy".
 */
export async function resolveUserDepartment(q: ResolveDepartmentQuery): Promise<AuthenticatedUser | null> {
  let lookup: ReturnType<typeof sql>;
  if (q.token !== undefined) {
    lookup = sql`(u.token = ${q.token} OR u.token = ${q.tokenHash ?? q.token})`;
  } else if (q.username !== undefined) {
    if (!Number.isInteger(q.sessionVersion)) return null;
    lookup = sql`u.username = ${q.username} AND u.session_version = ${q.sessionVersion}`;
  } else {
    return null;
  }

  return resolveCore(lookup, q.requested, q.explicit, q.token !== undefined);
}

/**
 * For a user whose identity was ALREADY verified by other means (PIN or LINE login on /api/mobile/confirm): resolves the
 * department scope without any session version, token or requested department. Pass the user returned by that
 * verification (its username comes from the database, never from the request).
 *
 * - looks the user up by exact username and still requires account_status = 'active';
 * - no requested department and not explicit: the default department (else the lowest-id active department the user
 *   belongs to; an Admin without membership rows gets the lowest-id active department);
 * - never returns scope "ALL" (a mobile approver always works in exactly one department);
 * - token_expiry is not checked (the PIN/LINE verification is the credential here);
 * - null when there is no usable department or no active account, like resolveUserDepartment.
 *
 * Only /api/mobile/confirm may use this (see department-context.verified-usage.test.ts).
 * Throws on database errors like resolveUserDepartment.
 */
export async function resolveDepartmentForVerifiedUser(verified: AuthenticatedUser): Promise<AuthenticatedUser | null> {
  return resolveCore(sql`u.username = ${verified.username}`, null, false, false);
}

async function resolveCore(lookup: ReturnType<typeof sql>, requested: RequestedDepartment, explicit: boolean, checkTokenExpiry: boolean): Promise<AuthenticatedUser | null> {
  const requestedValid = typeof requested === "number" && Number.isInteger(requested) && requested >= 1 && requested <= MAX_INT4;
  const requestedId = requestedValid ? (requested as number) : null;

  const rows = (await sql`
    SELECT u.username, u.name, u.role AS global_role, u.vendor, u.token_expiry,
           m.id AS department_id, m.code, m.member_role, m.matched,
           EXISTS (SELECT 1 FROM user_departments x WHERE x.username = u.username) AS has_membership
    FROM users u
    LEFT JOIN LATERAL (
      SELECT d.id, d.code, ud.role AS member_role, (d.id = ${requestedId} AND u.role <> 'Vendor') AS matched
      FROM departments d
      LEFT JOIN user_departments ud ON ud.department_id = d.id AND ud.username = u.username
      WHERE d.is_active AND (ud.username IS NOT NULL OR u.role = 'Admin')
      ORDER BY (d.id = ${requestedId} AND u.role <> 'Vendor') DESC, ud.is_default DESC NULLS LAST, d.id
      LIMIT 1
    ) m ON true
    WHERE ${lookup} AND u.account_status = 'active'
    LIMIT 1
  `) as Row[];

  const row = rows[0];
  if (!row) return null;

  // Same expiry rule as the legacy bearer path.
  if (checkTokenExpiry && row.token_expiry && new Date(row.token_expiry) < new Date()) return null;

  // users.role NULL stays null (like the legacy path), it must not become the string "null".
  const globalRole = (row.global_role ?? null) as string | null;
  const isAdmin = globalRole === "Admin";
  const isVendor = globalRole === "Vendor";
  const base = {
    username: row.username,
    name: row.name || row.username,
    vendor: row.vendor ?? undefined,
    globalRole: globalRole as string,
  };

  const departmentId = row.department_id;
  const departmentCode = row.code;
  const memberRole = row.member_role;
  const matched = row.matched === true;

  if (departmentId === null) {
    // No usable department: no membership at all (non-Admin), or only memberships in deactivated departments, or an
    // Admin while no department is active. All of these are rejected; deactivation and revocation must lock people out.
    if (row.has_membership !== true && !isAdmin) warnNoMembershipOnce(row.username);
    return null;
  }

  if (requested === "ALL" && isAdmin) {
    return { ...base, role: "Admin", departmentId: null, departmentCode: null, scope: "ALL" };
  }

  const denied = explicit && requested !== null && !isVendor && !matched;

  return {
    ...base,
    role: effectiveRole(globalRole, memberRole) as string,
    departmentId,
    departmentCode,
    scope: departmentId,
    ...(denied ? { departmentDenied: true as const } : {}),
  };
}
