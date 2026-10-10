import { describe, expect, it } from "vitest";
import {
  checkPendingSwitch,
  initialSwitcherState,
  interpretMeResponse,
  interpretSwitchResult,
  isSwitcherEngaged,
  makePending,
  parseDepartmentContext,
  PENDING_TTL_MS,
  resolveSwitchOutcome,
  shouldShowLoadError,
  shouldShowSwitcher,
  switcherChoices,
  switcherReducer,
  type DepartmentContext,
  type SwitcherState,
} from "@/lib/department-switcher-state";

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

const user1 = ctx();
const solo1 = ctx({ options: [CC] });
const vendor = ctx({ scope: 1, active: null, options: [] });
const allView = ctx({ scope: "ALL", active: null, options: [CC, MB], canViewAll: true, readOnly: true });
const adminOneDept = ctx({ options: [CC], canViewAll: true });
const codeNullPlusOne = ctx({ active: { id: 4, name: "งานอณูชีววิทยา", code: null }, scope: 4, options: [CC] });
const apiError = { message: "ไม่สำเร็จ", code: "X" };

describe("parseDepartmentContext", () => {
  it("parses a golden body", () => {
    expect(parseDepartmentContext(JSON.parse(JSON.stringify(user1)))).toEqual(user1);
    expect(parseDepartmentContext(JSON.parse(JSON.stringify(allView)))).toEqual(allView);
  });

  it("fails closed on broken input", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { ...user1, scope: "all" }, { ...user1, scope: 1.5 }, { ...user1, canViewAll: "yes" }, { ...user1, readOnly: undefined }, { ...user1, active: { id: "1", name: "a", code: null } }, { ...user1, active: undefined }]) {
      expect(parseDepartmentContext(bad)).toBeNull();
    }
  });

  it("turns a malformed options into options:null, keeps the rest", () => {
    for (const badOptions of [undefined, null, "x", {}, [{ id: 1 }], [CC, { id: 2, name: "a", code: null }], [null]]) {
      const parsed = parseDepartmentContext({ ...user1, options: badOptions });
      expect(parsed).not.toBeNull();
      expect(parsed?.options).toBeNull();
      expect(parsed?.active).toEqual(user1.active);
    }
  });

  it("accepts active with code null", () => {
    expect(parseDepartmentContext(codeNullPlusOne)?.active?.code).toBeNull();
  });
});

describe("shouldShowSwitcher", () => {
  it("shows for multi-department user, ALL view, and code-NULL department with one other", () => {
    expect(shouldShowSwitcher(user1)).toBe(true);
    expect(shouldShowSwitcher(allView)).toBe(true);
    expect(shouldShowSwitcher(codeNullPlusOne)).toBe(true);
  });
  it("hides for single department, vendor, Admin with one department, null ctx, options null", () => {
    expect(shouldShowSwitcher(solo1)).toBe(false);
    expect(shouldShowSwitcher(vendor)).toBe(false);
    expect(shouldShowSwitcher(adminOneDept)).toBe(false);
    expect(shouldShowSwitcher(null)).toBe(false);
    expect(shouldShowSwitcher(ctx({ options: null }))).toBe(false);
    // ALL view with no list: nothing to put in a select
    expect(shouldShowSwitcher(ctx({ scope: "ALL", active: null, options: null, canViewAll: true, readOnly: true }))).toBe(false);
  });
});

describe("shouldShowLoadError", () => {
  it("is false for ordinary users even when options is null (hide silently)", () => {
    expect(shouldShowLoadError(ctx({ options: null }))).toBe(false);
    expect(shouldShowLoadError(user1)).toBe(false);
    expect(shouldShowLoadError(null)).toBe(false);
  });
  it("is true for ALL scope or canViewAll with options null", () => {
    expect(shouldShowLoadError(ctx({ options: null, scope: "ALL", active: null, readOnly: true }))).toBe(true);
    expect(shouldShowLoadError(ctx({ options: null, canViewAll: true }))).toBe(true);
  });
  it("is false when options loaded", () => {
    expect(shouldShowLoadError(allView)).toBe(false);
  });
});

describe("switcherChoices", () => {
  it("lists options without ALL for ordinary users", () => {
    expect(switcherChoices(user1).map((c) => c.target)).toEqual([1, 2]);
  });
  it("adds ALL for global Admin with another department, and in the ALL view", () => {
    expect(switcherChoices(ctx({ canViewAll: true })).map((c) => c.target)).toEqual([1, 2, "ALL"]);
    expect(switcherChoices(allView).map((c) => c.target)).toEqual([1, 2, "ALL"]);
  });
  it("does not add ALL for a single-department Admin (Q2c proposed value)", () => {
    expect(switcherChoices(adminOneDept).map((c) => c.target)).toEqual([1]);
  });
  it("always includes the current department even if it is not in options (code NULL)", () => {
    const targets = switcherChoices(codeNullPlusOne);
    expect(targets.map((c) => c.target)).toEqual([4, 1]);
    expect(targets[0].label).toBe("งานอณูชีววิทยา");
  });
  it("returns [] for null ctx or options null", () => {
    expect(switcherChoices(null)).toEqual([]);
    expect(switcherChoices(ctx({ options: null }))).toEqual([]);
  });
});

describe("interpretMeResponse(ok, body)", () => {
  const golden = { success: true, user: { username: "u", department: "ห้อง A" } };

  it("2xx golden body (flag off): no ctx, original department", () => {
    expect(interpretMeResponse(true, golden)).toEqual({ signOut: false, department: "ห้อง A", ctx: null });
  });
  it("2xx with departmentContext", () => {
    const r = interpretMeResponse(true, { ...golden, departmentContext: user1 });
    expect(r).toEqual({ signOut: false, department: "ห้อง A", ctx: user1 });
  });
  it("2xx with broken ctx does NOT sign out", () => {
    const r = interpretMeResponse(true, { ...golden, departmentContext: { scope: "nope" } });
    expect(r).toEqual({ signOut: false, department: "ห้อง A", ctx: null });
  });
  it("2xx with unusable body does not sign out", () => {
    for (const body of [null, undefined, "x", []]) {
      expect(interpretMeResponse(true, body)).toEqual({ signOut: false, department: null, ctx: null });
    }
  });
  it("department missing -> null", () => {
    expect(interpretMeResponse(true, { user: {} }).department).toBeNull();
  });
  it("not ok (401) -> signOut", () => {
    expect(interpretMeResponse(false, { error: "Unauthorized" })).toEqual({ signOut: true, department: null, ctx: null });
  });
  it("not ok (500) -> signOut TOO. This keeps the pre-feature behaviour of auth-provider.tsx:69-73 on purpose", () => {
    expect(interpretMeResponse(false, { error: "Internal" })).toEqual({ signOut: true, department: null, ctx: null });
  });
  it("fail-closed: a non-boolean ok is treated as not ok", () => {
    expect(interpretMeResponse(undefined as unknown as boolean, golden).signOut).toBe(true);
  });
});

describe("interpretSwitchResult", () => {
  it("2xx -> reload", () => {
    expect(interpretSwitchResult(200, "")).toBe("reload");
    expect(interpretSwitchResult(204, undefined)).toBe("reload");
  });
  it("409 DEPARTMENTS_DISABLED -> hide", () => {
    expect(interpretSwitchResult(409, "DEPARTMENTS_DISABLED")).toBe("hide");
  });
  it("everything else -> error (never signOut)", () => {
    expect(interpretSwitchResult(409, "DEPARTMENT_READ_ONLY")).toBe("error");
    for (const status of [400, 401, 403, 404, 500, 0]) expect(interpretSwitchResult(status, "X")).toBe("error");
    expect(interpretSwitchResult(NaN, "X")).toBe("error");
  });
});

describe("resolveSwitchOutcome", () => {
  it("maps results to reload / hide / { error }", () => {
    expect(resolveSwitchOutcome({ status: 200, code: "" })).toBe("reload");
    expect(resolveSwitchOutcome({ status: 409, code: "DEPARTMENTS_DISABLED", error: apiError })).toBe("hide");
    expect(resolveSwitchOutcome({ status: 403, code: "X", error: apiError })).toEqual({ error: apiError });
  });
  it("builds an error when the result carries none", () => {
    const out = resolveSwitchOutcome({ status: 500, code: "" });
    expect(out).toMatchObject({ error: { message: "สลับงานไม่สำเร็จ", status: 500 } });
  });
});

describe("switcherReducer (pure: returns state only)", () => {
  const select2 = { type: "select", target: 2, current: 1 } as const;

  it("select another department -> confirming; no POST/side effect (just a value)", () => {
    expect(switcherReducer(initialSwitcherState, select2)).toEqual({ phase: "confirming", target: 2, error: null });
  });
  it("select the current department -> idle", () => {
    const confirming = switcherReducer(initialSwitcherState, select2);
    expect(switcherReducer(confirming, { type: "select", target: 1, current: 1 })).toEqual(initialSwitcherState);
  });
  it("select ignores a broken target", () => {
    expect(switcherReducer(initialSwitcherState, { type: "select", target: NaN, current: 1 })).toBe(initialSwitcherState);
  });
  it("cancel -> idle", () => {
    const confirming = switcherReducer(initialSwitcherState, select2);
    expect(switcherReducer(confirming, { type: "cancel" })).toEqual(initialSwitcherState);
  });
  it("confirm only works from confirming", () => {
    const confirming = switcherReducer(initialSwitcherState, select2);
    expect(switcherReducer(confirming, { type: "confirm" })).toEqual({ phase: "busy", target: 2, error: null });
    expect(switcherReducer(initialSwitcherState, { type: "confirm" })).toBe(initialSwitcherState);
  });
  it("busy returns the SAME state object for select / confirm / cancel", () => {
    const busy: SwitcherState = { phase: "busy", target: 2, error: null };
    expect(switcherReducer(busy, select2)).toBe(busy);
    expect(switcherReducer(busy, { type: "confirm" })).toBe(busy);
    expect(switcherReducer(busy, { type: "cancel" })).toBe(busy);
  });
  it("done from busy -> idle without error; done is ignored when not busy; other actions still ignored while busy", () => {
    const busy: SwitcherState = { phase: "busy", target: 2, error: null };
    expect(switcherReducer(busy, { type: "done" })).toEqual({ phase: "idle", error: null });
    const confirming: SwitcherState = { phase: "confirming", target: 2, error: null };
    expect(switcherReducer(confirming, { type: "done" })).toBe(confirming);
    expect(switcherReducer(initialSwitcherState, { type: "done" })).toBe(initialSwitcherState);
    expect(switcherReducer(busy, select2)).toBe(busy);
    expect(switcherReducer(busy, { type: "cancel" })).toBe(busy);
  });
  it("failed from busy -> idle with the error; select clears it", () => {
    const busy: SwitcherState = { phase: "busy", target: 2, error: null };
    const failed = switcherReducer(busy, { type: "failed", error: apiError });
    expect(failed).toEqual({ phase: "idle", error: apiError });
    expect(switcherReducer(failed, select2)).toEqual({ phase: "confirming", target: 2, error: null });
  });
  it("does not mutate the input state", () => {
    const frozen = Object.freeze({ phase: "confirming", target: 2, error: null }) as SwitcherState;
    expect(() => switcherReducer(frozen, { type: "confirm" })).not.toThrow();
  });
});

describe("isSwitcherEngaged", () => {
  it("is true when select focused, confirming or busy", () => {
    expect(isSwitcherEngaged(initialSwitcherState, true)).toBe(true);
    expect(isSwitcherEngaged({ phase: "confirming", target: 2, error: null }, false)).toBe(true);
    expect(isSwitcherEngaged({ phase: "busy", target: 2, error: null }, false)).toBe(true);
  });
  it("is false when idle and not focused (even with an error shown)", () => {
    expect(isSwitcherEngaged(initialSwitcherState, false)).toBe(false);
    expect(isSwitcherEngaged({ phase: "idle", error: apiError }, false)).toBe(false);
  });
});

describe("checkPendingSwitch", () => {
  const now = 1_000_000;
  it("ok when the active department matches", () => {
    expect(checkPendingSwitch(makePending(1, now - 1000), user1, now)).toBe("ok");
  });
  it("ok for ALL when scope is ALL", () => {
    expect(checkPendingSwitch(makePending("ALL", now), allView, now)).toBe("ok");
  });
  it("failed when it does not match", () => {
    expect(checkPendingSwitch(makePending(2, now), user1, now)).toBe("failed");
    expect(checkPendingSwitch(makePending("ALL", now), user1, now)).toBe("failed");
  });
  it("none when stale (older than the TTL), but the boundary still counts", () => {
    expect(checkPendingSwitch(makePending(2, now - PENDING_TTL_MS - 1), user1, now)).toBe("none");
    expect(checkPendingSwitch(makePending(2, now - PENDING_TTL_MS), user1, now)).toBe("failed");
  });
  it("none for a timestamp in the future", () => {
    expect(checkPendingSwitch(makePending(2, now + 5000), user1, now)).toBe("none");
  });
  it("none for empty, broken JSON, wrong shape, or null ctx", () => {
    expect(checkPendingSwitch(null, user1, now)).toBe("none");
    expect(checkPendingSwitch(undefined, user1, now)).toBe("none");
    expect(checkPendingSwitch("", user1, now)).toBe("none");
    expect(checkPendingSwitch("{not json", user1, now)).toBe("none");
    expect(checkPendingSwitch("[]", user1, now)).toBe("none");
    expect(checkPendingSwitch(JSON.stringify({ target: "x", at: now }), user1, now)).toBe("none");
    expect(checkPendingSwitch(JSON.stringify({ target: 2 }), user1, now)).toBe("none");
    expect(checkPendingSwitch(makePending(2, now), null, now)).toBe("none");
  });
});
