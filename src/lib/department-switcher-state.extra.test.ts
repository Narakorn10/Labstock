import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPendingSwitch,
  initialSwitcherState,
  interpretMeResponse,
  interpretSwitchResult,
  isSwitcherEngaged,
  makePending,
  switcherChoices,
  switcherReducer,
  type DepartmentContext,
  type SwitcherAction,
  type SwitcherState,
} from "@/lib/department-switcher-state";

// Gap-filling tests (step 6, steps 0B-5). Not repeating department-switcher-state.test.ts.

const CC = { id: 1, name: "เคมีคลินิก", code: "CC" };
const MB = { id: 2, name: "จุลชีววิทยา", code: "MB" };
const ctx = (over: Partial<DepartmentContext> = {}): DepartmentContext => ({
  scope: 1,
  active: { id: 1, name: CC.name, code: "CC" },
  options: [CC, MB],
  canViewAll: false,
  readOnly: false,
  ...over,
});
const apiError = { message: "ไม่สำเร็จ", code: "X" };

describe("switcherReducer extra", () => {
  const busy: SwitcherState = { phase: "busy", target: 2, error: null };

  it("busy returns the same object for every non-failed action, including select 'ALL' and a broken select", () => {
    const actions: SwitcherAction[] = [
      { type: "select", target: "ALL", current: 1 },
      { type: "select", target: 1, current: 1 },
      { type: "select", target: NaN, current: 1 },
      { type: "confirm" },
      { type: "cancel" },
    ];
    for (const action of actions) expect(switcherReducer(busy, action)).toBe(busy);
  });

  it("a second confirm after the first (double click) leaves busy untouched, so only one busy transition exists", () => {
    const confirming = switcherReducer(initialSwitcherState, { type: "select", target: 2, current: 1 });
    const first = switcherReducer(confirming, { type: "confirm" });
    expect(first.phase).toBe("busy");
    expect(switcherReducer(first, { type: "confirm" })).toBe(first);
  });

  it("failed while NOT busy still lands on idle + error (late failure never leaves confirming stuck)", () => {
    const confirming = switcherReducer(initialSwitcherState, { type: "select", target: 2, current: 1 });
    expect(switcherReducer(confirming, { type: "failed", error: apiError })).toEqual({ phase: "idle", error: apiError });
    expect(switcherReducer(initialSwitcherState, { type: "failed", error: apiError })).toEqual({ phase: "idle", error: apiError });
  });

  it("select another target while confirming replaces the target (no busy, no confirm)", () => {
    const toMb = switcherReducer(initialSwitcherState, { type: "select", target: 2, current: 1 });
    expect(switcherReducer(toMb, { type: "select", target: "ALL", current: 1 })).toEqual({ phase: "confirming", target: "ALL", error: null });
  });

  it("cancel clears a shown error; confirm from idle-with-error does nothing", () => {
    const withError: SwitcherState = { phase: "idle", error: apiError };
    expect(switcherReducer(withError, { type: "cancel" })).toEqual(initialSwitcherState);
    expect(switcherReducer(withError, { type: "confirm" })).toBe(withError);
  });

  it("select the current department (including 'ALL' in the ALL view) from idle returns the same idle state", () => {
    expect(switcherReducer(initialSwitcherState, { type: "select", target: "ALL", current: "ALL" })).toBe(initialSwitcherState);
    expect(switcherReducer(initialSwitcherState, { type: "select", target: 1, current: 1 })).toBe(initialSwitcherState);
  });

  it("an unknown action returns the same state (fail closed)", () => {
    const state: SwitcherState = { phase: "confirming", target: 2, error: null };
    expect(switcherReducer(state, { type: "bogus" } as unknown as SwitcherAction)).toBe(state);
  });

  it("only select can leave idle for confirming; select never reaches busy directly", () => {
    const after = switcherReducer(initialSwitcherState, { type: "select", target: 2, current: 1 });
    expect(after.phase).toBe("confirming");
  });
});

describe("isSwitcherEngaged extra", () => {
  it("busy / confirming stay engaged even when the select lost focus; a non-boolean focus does not engage", () => {
    expect(isSwitcherEngaged({ phase: "busy", target: 2, error: null }, false)).toBe(true);
    expect(isSwitcherEngaged(initialSwitcherState, undefined as unknown as boolean)).toBe(false);
  });
});

describe("checkPendingSwitch extra", () => {
  const now = 5_000_000;
  const allView = ctx({ scope: "ALL", active: null, readOnly: true, canViewAll: true });

  it("numeric target while in the ALL view (active null) is failed, not ok", () => {
    expect(checkPendingSwitch(makePending(1, now), allView, now)).toBe("failed");
  });
  it("'ALL' target while a numeric department is active is failed (already covered) and scope ALL with a numeric target is failed", () => {
    expect(checkPendingSwitch(makePending(2, now), allView, now)).toBe("failed");
  });
  it("target stored as a string id is not understood -> none (never a false failed)", () => {
    expect(checkPendingSwitch(JSON.stringify({ target: "2", at: now }), ctx(), now)).toBe("none");
  });
  it("non-finite / non-number timestamps -> none", () => {
    expect(checkPendingSwitch(JSON.stringify({ target: 1, at: "now" }), ctx(), now)).toBe("none");
    expect(checkPendingSwitch(JSON.stringify({ target: 1, at: null }), ctx(), now)).toBe("none");
    expect(checkPendingSwitch(makePending(1, now), ctx(), Number.NaN)).toBe("none");
  });
  it("JSON null / number / string payloads -> none", () => {
    for (const raw of ["null", "5", '"x"', "true"]) expect(checkPendingSwitch(raw, ctx(), now), raw).toBe("none");
  });
  it("makePending round-trips target and time", () => {
    expect(JSON.parse(makePending("ALL", 42))).toEqual({ target: "ALL", at: 42 });
  });
});

describe("switcherChoices extra", () => {
  it("global Admin in the ALL view with an empty options list still offers 'ALL' (and nothing else)", () => {
    const c = ctx({ scope: "ALL", active: null, options: [], canViewAll: true, readOnly: true });
    expect(switcherChoices(c).map((x) => x.target)).toEqual(["ALL"]);
  });
  it("ordinary user in a forged ALL scope without canViewAll is not offered 'ALL'", () => {
    const c = ctx({ scope: "ALL", active: null, canViewAll: false, readOnly: true });
    expect(switcherChoices(c).map((x) => x.target)).not.toContain("ALL");
  });
  it("Vendor (options []) with an active department gets only the active one", () => {
    expect(switcherChoices(ctx({ options: [] })).map((x) => x.target)).toEqual([1]);
  });
});

describe("interpretMeResponse / interpretSwitchResult extra", () => {
  it("every 2xx-shaped call keeps the session; every non-ok call signs out (documented legacy behaviour)", () => {
    expect(interpretMeResponse(true, { user: { department: "x" }, departmentContext: ctx() }).signOut).toBe(false);
    expect(interpretMeResponse(false, { user: { department: "x" }, departmentContext: ctx() })).toEqual({ signOut: true, department: null, ctx: null });
  });
  it("a non-string user.department is ignored (null), not a throw", () => {
    expect(interpretMeResponse(true, { user: { department: 5 } }).department).toBeNull();
    expect(interpretMeResponse(true, { user: "x" }).department).toBeNull();
  });
  it("interpretSwitchResult: no status in 100-199 / 300-399 / 400-599 ever returns reload or hide, except 409 DISABLED", () => {
    for (let status = 100; status < 600; status++) {
      const out = interpretSwitchResult(status, "DEPARTMENTS_DISABLED");
      if (status >= 200 && status < 300) expect(out, String(status)).toBe("reload");
      else if (status === 409) expect(out).toBe("hide");
      else expect(out, String(status)).toBe("error");
    }
    expect(interpretSwitchResult(409, undefined)).toBe("error");
    expect(interpretSwitchResult(409, "departments_disabled")).toBe("error");
  });
});

describe("client-safe module boundaries (static source check)", () => {
  const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");
  const importLines = (source: string) =>
    source.split("\n").filter((line) => /^\s*(import|export)\b.*\bfrom\b/.test(line) || /^\s*import\s+["']/.test(line));
  const FORBIDDEN = /next-auth|next\/navigation|next\/server|@\/auth\b|@\/lib\/db\b|\/db["']|departments-flag|department-switch["']|auth-provider|auth-utils|api-client["']/;

  it.each([
    "src/lib/department-switcher-types.ts",
    "src/lib/department-switcher-state.ts",
    "src/lib/department-session-client.ts",
    "src/components/department-switcher.tsx",
  ])("%s imports nothing server-side, no next-auth, no navigation, no api-client (axios)", (file) => {
    const offenders = importLines(read(file)).filter((line) => FORBIDDEN.test(line));
    expect(offenders).toEqual([]);
  });

  it("department-switcher-types.ts has no imports at all", () => {
    expect(importLines(read("src/lib/department-switcher-types.ts"))).toEqual([]);
  });

  it("department-session-client.ts never references signOut, redirect, location, Authorization or localStorage", () => {
    const source = read("src/lib/department-session-client.ts")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(source).not.toMatch(/signOut|redirect|window\.location|location\.|Authorization|localStorage|sessionStorage|\.reload\(/i);
  });
});
