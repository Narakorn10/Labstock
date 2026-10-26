import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Pure part of line-bot-queries: the command decision, the fail-closed actor check and the legacy statement text. The legacy
// text must equal the two statements the webhook sent before the department change (route.ts PO and tracking lookups).

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "@/lib/db";
import type { LineBotAccess } from "@/lib/line-liff-ordering";
import {
  LINE_BOT_MESSAGES,
  decideLineBotCommand,
  findPurchaseOrderForLine,
  findShipmentForLine,
  type LineBotActor,
} from "./line-bot-queries";

const sql = dbSql as unknown as PgliteSql;
const scope = { mode: "one", departmentId: 1 } as const;
const lab = (role: string): LineBotAccess => ({ state: "lab", role, scope });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await sql.db.close();
});

describe("decideLineBotCommand", () => {
  it("legacy keeps both commands with the old behaviour", () => {
    expect(decideLineBotCommand({ state: "legacy" }, "stock")).toEqual({ ok: true, command: "stock", scope: { mode: "legacy" } });
    expect(decideLineBotCommand({ state: "legacy" }, "purchasing")).toEqual({ ok: true, command: "purchasing", actor: { kind: "legacy" } });
  });

  it("unlinked and no_work get their own message for both commands", () => {
    for (const command of ["stock", "purchasing"] as const) {
      expect(decideLineBotCommand({ state: "unlinked" }, command)).toEqual({ ok: false, message: LINE_BOT_MESSAGES.unlinked });
      expect(decideLineBotCommand({ state: "no_work" }, command)).toEqual({ ok: false, message: LINE_BOT_MESSAGES.noWork });
    }
    expect(LINE_BOT_MESSAGES.unlinked).not.toBe(LINE_BOT_MESSAGES.noWork);
    // Owner-fixed texts (spec 5.4): compare against the literal, not only the constant.
    expect(LINE_BOT_MESSAGES.noWork).toBe("ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ");
    expect(LINE_BOT_MESSAGES.unlinked).toBe('บัญชี LINE นี้ยังไม่ได้ผูกกับบัญชี LabStock กรุณาผูกบัญชีก่อนใช้งานค่ะ (พิมพ์ "id" เพื่อดู LINE User ID)');
    expect(LINE_BOT_MESSAGES.unlinked).toContain('พิมพ์ "id"');
  });

  it("vendor cannot read stock but can read purchasing as that vendor", () => {
    expect(decideLineBotCommand({ state: "vendor", vendor: "V1" }, "stock")).toEqual({ ok: false, message: LINE_BOT_MESSAGES.vendorStockDenied });
    expect(decideLineBotCommand({ state: "vendor", vendor: "V1" }, "purchasing")).toEqual({
      ok: true,
      command: "purchasing",
      actor: { kind: "vendor", vendor: "V1" },
    });
  });

  it("lab Manager/Admin may read purchasing within their department", () => {
    for (const role of ["Manager", "Admin"]) {
      expect(decideLineBotCommand(lab(role), "purchasing")).toEqual({ ok: true, command: "purchasing", actor: { kind: "lab", scope } });
    }
  });

  it("lab User/Operator/Technician are denied purchasing", () => {
    for (const role of ["User", "Operator", "Technician"]) {
      expect(decideLineBotCommand(lab(role), "purchasing")).toEqual({ ok: false, message: LINE_BOT_MESSAGES.purchasingDenied });
    }
  });

  it("every lab role may read stock of its own department", () => {
    for (const role of ["Admin", "Manager", "User", "Operator", "Technician"]) {
      expect(decideLineBotCommand(lab(role), "stock")).toEqual({ ok: true, command: "stock", scope });
    }
  });

  // degraded: switch on, departments not ready. The account is linked and active (checked by the gate), but no department is
  // known, so the data is unfiltered (legacy statements); purchasing still needs Admin/Manager.
  it("degraded: every linked role may read stock, unfiltered", () => {
    for (const role of ["Admin", "Manager", "User", "Operator", "Technician"]) {
      expect(decideLineBotCommand({ state: "degraded", role }, "stock")).toEqual({ ok: true, command: "stock", scope: { mode: "legacy" } });
    }
  });

  it("degraded: Manager/Admin may read purchasing with the legacy actor", () => {
    for (const role of ["Manager", "Admin"]) {
      expect(decideLineBotCommand({ state: "degraded", role }, "purchasing")).toEqual({ ok: true, command: "purchasing", actor: { kind: "legacy" } });
    }
  });

  it("degraded: User/Operator/Technician (and an unknown role) are denied purchasing", () => {
    for (const role of ["User", "Operator", "Technician", "Vendor", ""]) {
      expect(decideLineBotCommand({ state: "degraded", role }, "purchasing"), role).toEqual({ ok: false, message: LINE_BOT_MESSAGES.purchasingDenied });
    }
  });
});

describe("legacy statement text", () => {
  async function capture(run: () => Promise<unknown>) {
    const statements: Array<{ text: string; params: unknown[] }> = [];
    vi.spyOn(sql.db, "query").mockImplementation((async (text: string, params: unknown[]) => {
      statements.push({ text, params });
      return { rows: [{ po_number: "PO-1" }] };
    }) as never);
    const result = await run();
    return { statements, result };
  }

  it("PO lookup equals route.ts:216 exactly", async () => {
    const { statements, result } = await capture(() => findPurchaseOrderForLine("PO-1", { kind: "legacy" }));
    expect(statements).toEqual([{ text: "SELECT * FROM purchase_orders WHERE po_number = $1", params: ["PO-1"] }]);
    expect(result).toEqual({ po_number: "PO-1" });
  });

  it("tracking lookup equals route.ts:249 exactly", async () => {
    const { statements, result } = await capture(() => findShipmentForLine("EE123456789TH", { kind: "legacy" }));
    expect(statements).toEqual([{ text: "SELECT * FROM shipments WHERE tracking_no = $1", params: ["EE123456789TH"] }]);
    expect(result).toEqual({ po_number: "PO-1" });
  });

  it("returns null when no row matches", async () => {
    vi.spyOn(sql.db, "query").mockImplementation((async () => ({ rows: [] })) as never);
    expect(await findPurchaseOrderForLine("PO-X", { kind: "legacy" })).toBeNull();
    expect(await findShipmentForLine("EE000000000TH", { kind: "legacy" })).toBeNull();
  });
});

describe("assertActor fails closed", () => {
  const bad = [
    undefined,
    null,
    "legacy",
    42,
    {},
    { kind: "admin" },
    { kind: "lab" },
    { kind: "lab", scope: { mode: "legacy" } },
    { kind: "lab", scope: { mode: "all" } },
    { kind: "lab", scope: { mode: "all", departmentId: 1 } },
    { kind: "lab", scope: { mode: "legacy", departmentId: 1 } },
    { kind: "lab", scope: { mode: "one" } },
    { kind: "lab", scope: { mode: "one", departmentId: 0 } },
    { kind: "lab", scope: { mode: "one", departmentId: -1 } },
    { kind: "lab", scope: { mode: "one", departmentId: 1.5 } },
    { kind: "lab", scope: { mode: "one", departmentId: "1" } },
    { kind: "vendor" },
    { kind: "vendor", vendor: 7 },
    { kind: "vendor", vendor: null },
  ] as unknown as LineBotActor[];

  it("throws in both functions and sends no SQL", async () => {
    const spy = vi.spyOn(sql.db, "query");
    for (const actor of bad) {
      await expect(findPurchaseOrderForLine("PO-1", actor)).rejects.toThrow();
      await expect(findShipmentForLine("EE123456789TH", actor)).rejects.toThrow();
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
