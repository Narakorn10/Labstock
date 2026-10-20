import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PgliteSql } from "@/test/pglite-sql";

// With DEPARTMENTS_ENABLED off (scope { mode: "legacy" }), createPurchaseOrderWithAudit must send EXACTLY the statements it
// sent before the per-department letterhead change (text, params, statement count), for both branches
// (storeLiffRequestId true with a liffRequestId, and false). The baseline JSON was captured from the ORIGINAL code
// (origin/main 4c97fbb), before purchase-order-creation.ts was touched.
//
// LIMIT: this proves identity only through the PGlite shim (createPgliteSql), which composes nested sql fragments itself.
// The real @neondatabase/serverless fragment composition cannot be proven offline, and fragments with params
// (`department_id = $n`) have never run on Neon with the flag off. Check that at rehearsal before enabling the flag.
//
// To regenerate the baseline on purpose (never done silently): UPDATE_CREATION_LEGACY_BASELINE=1 npx vitest run <this file>.

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
const mocks = vi.hoisted(() => ({ getSuggestions: vi.fn() }));
vi.mock("./purchase-order-suggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./purchase-order-suggestions")>()),
  getPurchaseOrderSuggestions: mocks.getSuggestions,
}));

import dbSql from "@/lib/db";
import { calculateSuggestion } from "./purchase-order-suggestions";
import { createPurchaseOrderWithAudit } from "./purchase-order-creation";

const sql = dbSql as unknown as PgliteSql;
const BASELINE_PATH = path.resolve(process.cwd(), "src/lib/purchase-order-creation.legacy-baseline.json");

function suggestion() {
  return calculateSuggestion({
    item_id: "CHEM-R-001", name: "Glucose", unit: "box", vendor: "Vendor A",
    min_threshold: 0, weekly_target: 0, quantity: 0,
    approved_monthly_target_boxes: 30, approved_order_qty_boxes: 15,
    orders_per_month: 2, lead_time_days: 7, safety_stock_boxes: 0,
    min_order_qty_boxes: 1, order_multiple_boxes: 1,
    source_verification_status: "VERIFIED", inventory_lots: [], on_order_lots: [],
    committed_no_eta_qty: 0, dispensed_14d: 0, dispense_observation_days: 0,
  }, new Date("2026-08-10T00:00:00.000Z"));
}

const base = {
  user: { username: "admin", name: "Admin", role: "Admin" },
  vendor: "Vendor A",
  items: [{ item_id: "CHEM-R-001", item_name: "Glucose", quantity: 15, unit: "box" }],
  note: "note",
  expectedDate: "2026-08-20",
  origin: "LAB" as const,
  scope: { mode: "legacy" as const },
};

async function capture(extra: Record<string, unknown>) {
  const transaction = vi.spyOn(sql, "transaction").mockResolvedValue([[], [], [{ purchase_order: { id: 1 }, items: [] }]] as never);
  await createPurchaseOrderWithAudit({ ...base, ...extra } as Parameters<typeof createPurchaseOrderWithAudit>[0]);
  const queries = transaction.mock.calls[0][0] as unknown as Array<{ text: string; params: unknown[] }>;
  return queries.map((query) => ({ text: query.text, params: query.params }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getSuggestions.mockReset();
  mocks.getSuggestions.mockResolvedValue([suggestion()]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-10T03:04:05.678Z"));
});

afterAll(async () => {
  vi.useRealTimers();
  await sql.db.close();
});

describe("createPurchaseOrderWithAudit with departments off (legacy)", () => {
  it("sends exactly the pre-change statements for both branches", async () => {
    const actual = {
      withLiffRequestId: await capture({ storeLiffRequestId: true, liffRequestId: "req-1" }),
      withoutLiffRequestId: await capture({}),
    };
    if (process.env.UPDATE_CREATION_LEGACY_BASELINE === "1") writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as typeof actual;

    for (const branch of ["withLiffRequestId", "withoutLiffRequestId"] as const) {
      expect(actual[branch]).toHaveLength(3);
      expect(baseline[branch]).toHaveLength(3);
      actual[branch].forEach((query, index) => {
        expect(query.text).toBe(baseline[branch][index].text);
        expect(query.params).toEqual(baseline[branch][index].params);
        expect(query.text).not.toMatch(/department_id/i);
      });
    }
    expect(actual).toEqual(baseline);
  });
});
