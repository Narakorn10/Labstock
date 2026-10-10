import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BUSY_TEXT,
  confirmMessage,
  DepartmentSwitcherView,
  LOAD_ERROR_TEXT,
  READ_ONLY_BADGE,
  type DepartmentSwitcherViewProps,
} from "@/components/department-switcher";
import { ALL_LABEL, type DepartmentContext, type SwitcherState } from "@/lib/department-switcher-state";

const CC = { id: 1, name: "ห้องปฏิบัติการเคมีคลินิก", code: "CC" };
const MB = { id: 2, name: "จุลชีววิทยา", code: "MB" };

function ctxOf(over: Partial<DepartmentContext> = {}): DepartmentContext {
  return { scope: 1, active: CC, options: [CC, MB], canViewAll: false, readOnly: false, ...over };
}

function html(props: DepartmentSwitcherViewProps): string {
  return renderToStaticMarkup(<DepartmentSwitcherView {...props} />);
}

const confirming: SwitcherState = { phase: "confirming", target: 2, error: null };
const busy: SwitcherState = { phase: "busy", target: 2, error: null };

describe("DepartmentSwitcherView", () => {
  it("renders nothing without ctx", () => {
    expect(renderToStaticMarkup(<DepartmentSwitcherView ctx={null} />)).toBe("");
  });

  it("renders nothing for a solo user (only the current department)", () => {
    expect(html({ ctx: ctxOf({ options: [CC] }) })).toBe("");
  });

  it("multi-department user: select with all rooms and the current name in bold", () => {
    const out = html({ ctx: ctxOf() });
    expect(out).toContain("<select");
    expect(out).toContain(MB.name);
    expect(out).toContain("font-bold text-ink");
    expect(out).toContain(`title="${CC.name}"`);
    expect(out).not.toContain("alertdialog");
    expect(out).not.toContain('disabled=""');
  });

  it("confirming: alertdialog with the warning text and both buttons, select still enabled", () => {
    const out = html({ ctx: ctxOf(), state: confirming });
    expect(out).toContain('role="alertdialog"');
    expect(out).toContain("สลับไปงาน จุลชีววิทยา? ข้อมูลที่ยังไม่บันทึกในหน้านี้จะหาย");
    expect(out).toContain(confirmMessage(MB.name));
    expect(out).toContain("สลับงาน</button>");
    expect(out).toContain("ยกเลิก</button>");
    expect(out).not.toContain('disabled=""');
    expect(out).not.toContain(BUSY_TEXT);
  });

  it("busy: select and both buttons disabled, busy text shown", () => {
    const out = html({ ctx: ctxOf(), state: busy });
    expect(out).toContain(BUSY_TEXT);
    expect(out.match(/<select[^>]*disabled=""/)).not.toBeNull();
    const buttons = out.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toContain('disabled=""');
  });

  it("idle with a switch error: shows message and hint", () => {
    const out = html({
      ctx: ctxOf(),
      state: { phase: "idle", error: { message: "สลับงานไม่สำเร็จ", hint: "ลองใหม่อีกครั้ง", code: "X" } },
    });
    expect(out).toContain('role="alert"');
    expect(out).toContain("สลับงานไม่สำเร็จ");
    expect(out).toContain("ลองใหม่อีกครั้ง");
  });

  it("ALL view (read-only): badge, ALL label as current name, ALL choice selected", () => {
    const out = html({ ctx: ctxOf({ scope: "ALL", active: null, canViewAll: true, readOnly: true }) });
    expect(out).toContain(READ_ONLY_BADGE);
    expect(out).toContain(ALL_LABEL);
    expect(out).toContain('<option value="ALL" selected="">');
  });

  it("load error shows only for ALL / canViewAll, with a retry button", () => {
    const admin = html({ ctx: ctxOf({ options: null, canViewAll: true }) });
    expect(admin).toContain(LOAD_ERROR_TEXT);
    expect(admin).toContain("ลองใหม่</button>");
    const allView = html({ ctx: ctxOf({ scope: "ALL", active: null, options: null, canViewAll: true, readOnly: true }) });
    expect(allView).toContain(LOAD_ERROR_TEXT);
    const normal = html({ ctx: ctxOf({ options: null }) });
    expect(normal).not.toContain(LOAD_ERROR_TEXT);
  });

  it("retrying disables the retry button", () => {
    const out = html({ ctx: ctxOf({ options: null, canViewAll: true }), retrying: true });
    expect(out.match(/<button[^>]*disabled=""/)).not.toBeNull();
  });

  it("options null with an active department: read-only name, no select, no error for a normal user", () => {
    const out = html({ ctx: ctxOf({ options: null }) });
    expect(out).toContain(CC.name);
    expect(out).not.toContain("<select");
    expect(out).not.toContain(LOAD_ERROR_TEXT);
  });

  it("shows the one-shot notice", () => {
    const out = html({ ctx: ctxOf(), notice: "สลับไปงาน จุลชีววิทยา แล้ว" });
    expect(out).toContain('role="status"');
    expect(out).toContain("สลับไปงาน จุลชีววิทยา แล้ว");
  });
});
