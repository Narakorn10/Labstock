// Pure logic for the department switcher (step 6). No server imports on purpose (db, departments-flag,
// department-switch, next-auth, next/navigation): the file is used by client components. Every function is
// fail-closed: broken input gives "show nothing / do nothing", never a throw.
import type { ApiErrorInfo } from "@/lib/api-errors-client";
import { fetchErrorShape, parseApiError } from "@/lib/api-errors-client";
import type { DepartmentContext, DepartmentOption, SwitchTarget } from "@/lib/department-switcher-types";

export type { DepartmentContext, DepartmentOption, SwitchTarget } from "@/lib/department-switcher-types";

/** Open question Q2c: whether a global Admin with a single department sees the "ALL" choice. Proposed: no. */
export const SHOW_ALL_FOR_SINGLE_DEPT_ADMIN = false;

export const ALL_LABEL = "ดูทุกงาน (อ่านอย่างเดียว)";
export const SWITCH_FALLBACK_MESSAGE = "สลับงานไม่สำเร็จ";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isTarget(value: unknown): value is SwitchTarget {
  return value === "ALL" || isId(value);
}

// ---------------------------------------------------------------- /api/auth/me

function parseOptions(value: unknown): DepartmentOption[] | null {
  if (!Array.isArray(value)) return null;
  const out: DepartmentOption[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isId(item.id) || typeof item.name !== "string" || typeof item.code !== "string") return null;
    out.push({ id: item.id, name: item.name, code: item.code });
  }
  return out;
}

/** Parse `body.departmentContext`-shaped value. null when missing or broken; a broken `options` becomes null (not the whole ctx). */
export function parseDepartmentContext(value: unknown): DepartmentContext | null {
  if (!isRecord(value)) return null;
  const { scope, active, canViewAll, readOnly } = value;
  if (!(scope === "ALL" || isId(scope))) return null;
  if (typeof canViewAll !== "boolean" || typeof readOnly !== "boolean") return null;
  let parsedActive: DepartmentContext["active"];
  if (active === null) {
    parsedActive = null;
  } else if (
    isRecord(active) &&
    isId(active.id) &&
    typeof active.name === "string" &&
    (active.code === null || typeof active.code === "string")
  ) {
    parsedActive = { id: active.id, name: active.name, code: active.code };
  } else {
    return null;
  }
  return { scope, active: parsedActive, options: parseOptions(value.options), canViewAll, readOnly };
}

/** Options the user may switch to (+ the current department so the select always shows it, + "ALL" for global Admin). */
export function switcherChoices(ctx: DepartmentContext | null): Array<{ target: SwitchTarget; label: string }> {
  if (!ctx || !ctx.options) return [];
  const choices: Array<{ target: SwitchTarget; label: string }> = [];
  const active = ctx.active;
  if (active && !ctx.options.some((o) => o.id === active.id)) choices.push({ target: active.id, label: active.name });
  for (const o of ctx.options) choices.push({ target: o.id, label: o.name });
  const hasOther = ctx.options.some((o) => o.id !== active?.id);
  if (ctx.canViewAll && (ctx.scope === "ALL" || hasOther || SHOW_ALL_FOR_SINGLE_DEPT_ADMIN)) {
    choices.push({ target: "ALL", label: ALL_LABEL });
  }
  return choices;
}

/** Show the switcher: in the ALL view, or when there is at least one other department to switch to. No list (null) -> no select. */
export function shouldShowSwitcher(ctx: DepartmentContext | null): boolean {
  if (!ctx || !ctx.options) return false;
  if (ctx.scope === "ALL") return true;
  return ctx.options.some((o) => o.id !== ctx.active?.id);
}

/** The list could not be loaded: only ALL / global Admin are told; everyone else sees nothing. */
export function shouldShowLoadError(ctx: DepartmentContext | null): boolean {
  if (!ctx) return false;
  return ctx.options === null && (ctx.scope === "ALL" || ctx.canViewAll);
}

export type MeInterpretation = {
  signOut: boolean;
  department: string | null;
  ctx: DepartmentContext | null;
};

/**
 * Decide what auth-provider does with the `/api/auth/me` answer. `ok` = `response.ok` (any 2xx, never `=== 200`).
 * NOT ok (401, 403, 404, **500 too**) -> signOut:true. That is the behaviour that existed before this feature
 * (`auth-provider.tsx:69-73`) and is kept on purpose, so a 500 still signs the user out.
 */
export function interpretMeResponse(ok: boolean, body: unknown): MeInterpretation {
  if (ok !== true) return { signOut: true, department: null, ctx: null };
  if (!isRecord(body)) return { signOut: false, department: null, ctx: null };
  const user = isRecord(body.user) ? body.user : null;
  const department = typeof user?.department === "string" ? user.department : null;
  return { signOut: false, department, ctx: parseDepartmentContext(body.departmentContext) };
}

// ---------------------------------------------------------------- switch result

/** What `postDepartmentSwitch` returns (never throws). */
export type SwitchPostResult = { status: number; code: string; error?: ApiErrorInfo };

export type SwitchOutcome = "reload" | "hide" | { error: ApiErrorInfo };

export function interpretSwitchResult(status: number, code: string | undefined): "reload" | "hide" | "error" {
  if (typeof status === "number" && status >= 200 && status < 300) return "reload";
  if (status === 409 && code === "DEPARTMENTS_DISABLED") return "hide";
  return "error";
}

/** postDepartmentSwitch result -> the value `switchDepartment()` resolves with. Never signOut, never redirect. */
export function resolveSwitchOutcome(result: SwitchPostResult): SwitchOutcome {
  const kind = interpretSwitchResult(result.status, result.code);
  if (kind !== "error") return kind;
  return {
    error: result.error ?? parseApiError(fetchErrorShape(result.status, { code: result.code }), SWITCH_FALLBACK_MESSAGE),
  };
}

// ---------------------------------------------------------------- reducer

export type SwitcherState =
  | { phase: "idle"; error: ApiErrorInfo | null }
  | { phase: "confirming"; target: SwitchTarget; error: null }
  | { phase: "busy"; target: SwitchTarget; error: null };

export type SwitcherAction =
  | { type: "select"; target: SwitchTarget; current: SwitchTarget }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "failed"; error: ApiErrorInfo }
  | { type: "done" };

export const initialSwitcherState: SwitcherState = { phase: "idle", error: null };

/**
 * Pure: returns the new state only. While busy everything except `failed` / `done` returns the same state object.
 * `done` = the switch ended without an error and without a reload (e.g. "hide"): busy -> idle. Ignored when not busy.
 */
export function switcherReducer(state: SwitcherState, action: SwitcherAction): SwitcherState {
  if (state.phase === "busy") {
    if (action.type === "failed") return { phase: "idle", error: action.error };
    return action.type === "done" ? initialSwitcherState : state;
  }
  switch (action.type) {
    case "select":
      if (!isTarget(action.target)) return state;
      // choosing the current department just clears any pending choice
      if (action.target === action.current) return state.phase === "idle" && state.error === null ? state : initialSwitcherState;
      return { phase: "confirming", target: action.target, error: null };
    case "cancel":
      return state.phase === "idle" && state.error === null ? state : initialSwitcherState;
    case "confirm":
      return state.phase === "confirming" ? { phase: "busy", target: state.target, error: null } : state;
    case "failed":
      return { phase: "idle", error: action.error };
    default:
      return state;
  }
}

/** True while the sidebar must stay open: select focused, or confirming / busy. */
export function isSwitcherEngaged(state: SwitcherState, selectFocused: boolean): boolean {
  return selectFocused === true || state.phase !== "idle";
}

// ---------------------------------------------------------------- pending switch (survives the reload)

export const PENDING_KEY = "labstock_pending_department_switch";
export const PENDING_TTL_MS = 120_000;

/** Serialized value to put in sessionStorage right before reloading. */
export function makePending(target: SwitchTarget, now: number): string {
  return JSON.stringify({ target, at: now });
}

/** After the reload: did the switch land? none = nothing to say (empty, broken, stale, or no ctx). */
export function checkPendingSwitch(
  raw: string | null | undefined,
  ctx: DepartmentContext | null,
  now: number,
): "ok" | "failed" | "none" {
  if (!raw || !ctx) return "none";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "none";
  }
  if (!isRecord(parsed) || !isTarget(parsed.target) || typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return "none";
  const age = now - parsed.at;
  if (!Number.isFinite(age) || age < 0 || age > PENDING_TTL_MS) return "none";
  if (parsed.target === "ALL") return ctx.scope === "ALL" ? "ok" : "failed";
  return ctx.active?.id === parsed.target ? "ok" : "failed";
}
