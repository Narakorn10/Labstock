import crypto from "crypto";
import sql from "@/lib/db";
import type { AuthenticatedUser } from "@/lib/auth-utils";
import { apiError } from "@/lib/api-response";
import { departmentsReady } from "@/lib/departments-flag";

// Department (multi-lab) scoping helpers for SQL.
//
// getDepartmentScope(user) turns the authenticated user into a DepartmentScope; the helpers below turn the scope
// into fragments of the same `sql` tagged template, so a route can be migrated one query at a time:
//
//   const scope = await getDepartmentScope(user);
//   await sql`SELECT * FROM master_data m WHERE m.is_active = true${andDept(scope, "m")}`;
//
// With departments off (flag off / migrations not applied) the scope is "legacy" and every helper returns an EMPTY or
// neutral fragment, so migrated queries behave exactly like the old ones.
//
// READ vs WRITE (important): deptWhere / andDept are READ helpers. In mode "all" (global Admin viewing every
// department) they add NO filter, which is right for SELECT but would let an UPDATE/DELETE touch every department.
// Therefore UPDATE, DELETE and anything else that modifies rows MUST use deptWhereWrite / andDeptWrite (and
// writeDepartmentId / deptInsert for INSERT). Those throw DEPARTMENT_READ_ONLY in mode "all"; otherwise they behave
// like the read helpers (legacy => empty / TRUE).

export type DepartmentScope =
  | { mode: "legacy" }
  | { mode: "one"; departmentId: number }
  | { mode: "all" };

export type DepartmentScopeErrorCode = "DEPARTMENT_NOT_FOUND" | "DEPARTMENT_READ_ONLY" | "DEPARTMENT_SCOPE_MISSING";

export class DepartmentScopeError extends Error {
  readonly code: DepartmentScopeErrorCode;

  constructor(code: DepartmentScopeErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DepartmentScopeError";
    this.code = code;
  }
}

type SqlFragment = ReturnType<typeof sql>;

const ALIAS_PATTERN = /^[a-z_][a-z0-9_]{0,30}$/;

/**
 * - user.departmentDenied (asked for a department they are not in) -> DEPARTMENT_NOT_FOUND (route answers 404)
 * - departments ready but the user has no scope field at all -> DEPARTMENT_SCOPE_MISSING (fail closed: a code path
 *   built a user without going through resolveUserDepartment, so we must not silently show every department)
 * - scope null (legacy) or undefined while departments are NOT ready -> legacy (no filtering)
 * - scope null while departments ARE ready -> DEPARTMENT_SCOPE_MISSING too: the ready path never produces a null scope,
 *   so a null here means a code path bypassed resolveUserDepartment (fail closed)
 */
export async function getDepartmentScope(user: AuthenticatedUser): Promise<DepartmentScope> {
  if (user.departmentDenied) throw new DepartmentScopeError("DEPARTMENT_NOT_FOUND", "user asked for a department they are not a member of");
  if (user.scope === "ALL") return { mode: "all" };
  if (typeof user.scope === "number") return { mode: "one", departmentId: user.scope };
  // scope === undefined or null
  if (await departmentsReady()) {
    throw new DepartmentScopeError(
      "DEPARTMENT_SCOPE_MISSING",
      `departments are ready but user "${user.username}" has no department scope (user was not built by resolveUserDepartment)`,
    );
  }
  return { mode: "legacy" };
}

function columnRef(alias?: string): ReturnType<typeof sql.unsafe> {
  if (alias === undefined) return sql.unsafe("department_id");
  if (!ALIAS_PATTERN.test(alias)) throw new Error(`Invalid SQL alias: ${JSON.stringify(alias)}`);
  return sql.unsafe(`${alias}.department_id`);
}

/** READ only. For WHERE: legacy and "all" -> TRUE, one -> `<alias>.department_id = <id>`. For UPDATE/DELETE use deptWhereWrite. */
export function deptWhere(scope: DepartmentScope, alias?: string): SqlFragment {
  const column = columnRef(alias); // validate the alias even when the fragment ends up neutral
  if (scope.mode !== "one") return sql`TRUE`;
  return sql`${column} = ${scope.departmentId}`;
}

/** READ only. Appended to an existing WHERE: legacy and "all" -> empty, one -> ` AND <alias>.department_id = <id>`. For UPDATE/DELETE use andDeptWrite. */
export function andDept(scope: DepartmentScope, alias?: string): SqlFragment {
  const column = columnRef(alias);
  if (scope.mode !== "one") return sql``;
  return sql` AND ${column} = ${scope.departmentId}`;
}

/** WRITE variant of deptWhere (UPDATE/DELETE): "all" -> DEPARTMENT_READ_ONLY, otherwise same as deptWhere. */
export function deptWhereWrite(scope: DepartmentScope, alias?: string): SqlFragment {
  if (scope.mode === "all") throw new DepartmentScopeError("DEPARTMENT_READ_ONLY", "cannot write while viewing all departments");
  return deptWhere(scope, alias);
}

/** WRITE variant of andDept (UPDATE/DELETE): "all" -> DEPARTMENT_READ_ONLY, otherwise same as andDept. */
export function andDeptWrite(scope: DepartmentScope, alias?: string): SqlFragment {
  if (scope.mode === "all") throw new DepartmentScopeError("DEPARTMENT_READ_ONLY", "cannot write while viewing all departments");
  return andDept(scope, alias);
}

/** Department id to write: legacy -> null (the column default applies), one -> the id, all -> DEPARTMENT_READ_ONLY. */
export function writeDepartmentId(scope: DepartmentScope): number | null {
  if (scope.mode === "all") throw new DepartmentScopeError("DEPARTMENT_READ_ONLY", "cannot write while viewing all departments");
  return scope.mode === "one" ? scope.departmentId : null;
}

/**
 * Fragments for INSERT. Both carry their own leading comma so legacy can be completely empty:
 *   sql`INSERT INTO vendors (name${column}) VALUES (${name}${value})`
 * legacy -> both empty (the DB default fills department_id), one -> `, department_id` / `, <id>`,
 * all -> DEPARTMENT_READ_ONLY.
 */
export function deptInsert(scope: DepartmentScope): { column: SqlFragment; value: SqlFragment } {
  const id = writeDepartmentId(scope);
  if (id === null) return { column: sql``, value: sql`` };
  return { column: sql`, department_id`, value: sql`, ${id}` };
}

/**
 * Maps a DepartmentScopeError to the catalogue response. Returns null for any other error so the caller handles it.
 * Routes should pass their own ctx.requestId so the response, the logs and x-request-id all share one id
 * (a random one is generated only as a fallback).
 */
export function departmentErrorResponse(e: unknown, requestId: string = crypto.randomUUID()): Response | null {
  if (!(e instanceof DepartmentScopeError)) return null;
  if (e.code === "DEPARTMENT_NOT_FOUND") return apiError("DEPARTMENT_NOT_FOUND", { requestId });
  if (e.code === "DEPARTMENT_READ_ONLY") return apiError("DEPARTMENT_READ_ONLY", { requestId });
  console.error(`[departments] ${e.code}: ${e.message}`, { requestId });
  return apiError("INTERNAL_ERROR", { requestId });
}
