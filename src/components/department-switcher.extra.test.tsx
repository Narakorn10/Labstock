import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BUSY_TEXT, DepartmentSwitcherView, LOAD_ERROR_TEXT, type DepartmentSwitcherViewProps } from "@/components/department-switcher";
import { ALL_LABEL, type DepartmentContext, type SwitcherState } from "@/lib/department-switcher-state";

// Gap-filling tests (step 6, step 5). Not repeating department-switcher.test.tsx.

const CC = { id: 1, name: "ห้องปฏิบัติการเคมีคลินิก", code: "CC" };
const MB = { id: 2, name: "จุลชีววิทยา", code: "MB" };
const ctxOf = (over: Partial<DepartmentContext> = {}): DepartmentContext => ({
  scope: 1,
  active: CC,
  options: [CC, MB],
  canViewAll: false,
  readOnly: false,
  ...over,
});
const html = (props: DepartmentSwitcherViewProps) => renderToStaticMarkup(<DepartmentSwitcherView {...props} />);

describe("DepartmentSwitcherView extra", () => {
  it("vendor (the exact /me shape: options [] with an active department): renders nothing", () => {
    expect(html({ ctx: ctxOf({ options: [] }) })).toBe("");
    expect(html({ ctx: ctxOf({ options: [], active: null }) })).toBe("");
  });

  it("current department without a code (active code null) plus one other: select shows the real name of the current one", () => {
    const out = html({ ctx: ctxOf({ scope: 4, active: { id: 4, name: "งานอณูชีววิทยา", code: null }, options: [CC] }) });
    expect(out).toContain("<select");
    expect(out).toContain("งานอณูชีววิทยา");
    expect(out).toContain('<option value="4" selected="">');
    expect(out).toContain('<option value="1">');
  });

  it("current department without a code and nothing else: renders nothing", () => {
    expect(html({ ctx: ctxOf({ scope: 4, active: { id: 4, name: "งานอณูชีววิทยา", code: null }, options: [] }) })).toBe("");
  });

  it("global Admin in ALL with no options at all (list empty): still shows the read-only badge and the ALL choice", () => {
    const out = html({ ctx: ctxOf({ scope: "ALL", active: null, options: [], canViewAll: true, readOnly: true }) });
    expect(out).toContain("<select");
    expect(out).toContain(ALL_LABEL);
    expect(out).toContain("อ่านอย่างเดียว");
  });

  it("global Admin in a department with another one: ALL choice is offered but not selected", () => {
    const out = html({ ctx: ctxOf({ canViewAll: true }) });
    expect(out).toContain('<option value="ALL">');
    expect(out).not.toContain('<option value="ALL" selected=""');
  });

  it("ordinary user: no ALL option", () => {
    expect(html({ ctx: ctxOf() })).not.toContain('value="ALL"');
  });

  it("confirming ALL: the warning names the ALL label", () => {
    const state: SwitcherState = { phase: "confirming", target: "ALL", error: null };
    expect(html({ ctx: ctxOf({ canViewAll: true }), state })).toContain(`สลับไปงาน ${ALL_LABEL}?`);
  });

  it("busy: no select-change handler path is rendered as enabled, and the load-error retry is not shown for a normal user", () => {
    const state: SwitcherState = { phase: "busy", target: 2, error: null };
    const out = html({ ctx: ctxOf(), state });
    expect(out).toContain(BUSY_TEXT);
    expect(out).not.toContain(LOAD_ERROR_TEXT);
  });

  it("the switch error and the confirm panel are never shown together (error only when idle)", () => {
    const idleWithError = html({ ctx: ctxOf(), state: { phase: "idle", error: { message: "พัง", code: "X" } } });
    expect(idleWithError).toContain("พัง");
    expect(idleWithError).not.toContain("alertdialog");
    const confirming = html({ ctx: ctxOf(), state: { phase: "confirming", target: 2, error: null } });
    expect(confirming).not.toContain('role="alert"');
  });

  it("a confirm panel is not rendered when there is nothing to switch to (solo user with a stale confirming state)", () => {
    const out = html({ ctx: ctxOf({ options: [CC] }), state: { phase: "confirming", target: 2, error: null } });
    expect(out).toBe("");
  });

  it("options null for ALL view: error + retry, and the read-only badge stays so nobody writes by mistake", () => {
    const out = html({ ctx: ctxOf({ scope: "ALL", active: null, options: null, canViewAll: true, readOnly: true }) });
    expect(out).toContain(LOAD_ERROR_TEXT);
    expect(out).toContain("อ่านอย่างเดียว");
    expect(out).toContain("ลองใหม่");
    expect(out).not.toContain("<select");
  });

  // Plan 5b: "select uses the pending value > active/ALL".
  it("while confirming, the select shows the pending target as selected", () => {
    const out = html({ ctx: ctxOf(), state: { phase: "confirming", target: 2, error: null } });
    expect(out).toContain('<option value="2" selected="">');
  });

  it("confirm panel does not steal focus from the select (no autofocus)", () => {
    const out = html({ ctx: ctxOf(), state: { phase: "confirming", target: 2, error: null } });
    expect(out).not.toContain("autofocus");
  });
});
