import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PgliteSql } from "@/test/pglite-sql";

// With DEPARTMENTS_ENABLED off (scope { mode: "legacy" }), the four bot stock queries (bot-stock-queries.ts, used by the
// Telegram and LINE webhooks) must do EXACTLY what they did before the department change: same SQL text, same params, same
// number of statements, same value returned. The baseline JSON was captured from the ORIGINAL code (main 65796e2), before
// the file was touched.
//
// LIMIT: this proves identity only through the PGlite shim (createPgliteSql), which composes nested sql fragments itself.
// It was never run against Neon: check the scoped queries on real Neon at rehearsal before enabling the flag. Rows are
// canned (no real data), so the DATE parser the other baselines need is not used: none of these queries returns a DATE column.
//
// To regenerate the baseline on purpose (never done silently): UPDATE_BOT_STOCK_BASELINE=1 npx vitest run <this file>.

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "@/lib/db";
import * as queries from "./bot-stock-queries";

const legacy = { mode: "legacy" } as const;
const sql = dbSql as unknown as PgliteSql;
const BASELINE_PATH = path.resolve(process.cwd(), "src/lib/bot-stock-queries.legacy-baseline.json");

type Row = Record<string, unknown>;
type Captured = Array<{ text: string; params: unknown[] }>;

const stockRows: Row[] = [
  { itemId: "LAB-000001", name: "Reagent 1", unit: "box", minThreshold: 5, quantity: "2", jobType: "Chem", machineType: "Cobas" },
  { itemId: "LAB-000002", name: "Reagent 2", unit: "kit", minThreshold: 3, quantity: "0", jobType: "Unassigned job", machineType: "Unassigned machine" },
];
const logRows: Row[] = [
  { timestamp: new Date("2026-08-10T01:02:03.000Z"), action: "RECEIVE", itemId: "LAB-000001", name: "Reagent 1", lotNo: "L1", qty: "4", user: "user1" },
  { timestamp: new Date("2026-08-09T01:02:03.000Z"), action: "DISPENSE", itemId: "LAB-000002", name: "Reagent 2", lotNo: "L2", qty: "1", user: "solo1" },
];

beforeAll(async () => {
  await sql.db.waitReady;
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await sql.db.close();
});

// Records every statement the function sends and answers with the canned rows.
async function capture(run: () => Promise<unknown>, rows: Row[]) {
  const statements: Captured = [];
  vi.spyOn(sql.db, "query").mockImplementation((async (text: string, params: unknown[]) => {
    statements.push({ text, params });
    return { rows };
  }) as never);
  const result = await run();
  vi.restoreAllMocks();
  return { statements, result };
}

describe("bot stock queries with departments off (legacy)", () => {
  it("sends exactly the pre-change statements and returns the same rows", async () => {
    const results = {
      logsWithRows: await capture(() => queries.getRecentLogRows(5, legacy), logRows),
      logsEmpty: await capture(() => queries.getRecentLogRows(10, legacy), []),
      lowDefaultLimit: await capture(() => queries.getLowStockRows(undefined, legacy), stockRows),
      lowLimit3: await capture(() => queries.getLowStockRows(3, legacy), stockRows),
      lowEmpty: await capture(() => queries.getLowStockRows(10, legacy), []),
      searchByName: await capture(() => queries.searchStockRows("Reagent", 10, legacy), stockRows),
      searchByItemId: await capture(() => queries.searchStockRows("LAB-000001", 10, legacy), stockRows.slice(0, 1)),
      searchByBarcode: await capture(() => queries.searchStockRows("8851234567890", 10, legacy), stockRows.slice(0, 1)),
      searchDefaultLimit: await capture(() => queries.searchStockRows("lab", undefined, legacy), stockRows),
      searchEmptyKeyword: await capture(() => queries.searchStockRows("", 10, legacy), stockRows),
      searchNoMatch: await capture(() => queries.searchStockRows("zzz-none", 10, legacy), []),
      jobWithRows: await capture(() => queries.searchStockRowsByJob("Chem", legacy), stockRows),
      jobEmptyKeyword: await capture(() => queries.searchStockRowsByJob("", legacy), stockRows),
      jobNoMatch: await capture(() => queries.searchStockRowsByJob("zzz-none", legacy), []),
    };

    // Sanity: each call sent exactly one statement and the returned rows are the canned ones.
    for (const [key, value] of Object.entries(results)) expect(value.statements, key).toHaveLength(1);
    expect(results.logsWithRows.result).toEqual(logRows);
    expect(results.lowEmpty.result).toEqual([]);
    expect(results.searchByBarcode.statements[0].params).toEqual(["%8851234567890%", "%8851234567890%", "%8851234567890%", 10]);

    const actual = JSON.parse(JSON.stringify(results)) as typeof results;
    if (process.env.UPDATE_BOT_STOCK_BASELINE === "1") writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as typeof actual;

    expect(Object.keys(actual)).toEqual(Object.keys(baseline));
    for (const key of Object.keys(baseline) as Array<keyof typeof results>) {
      expect(actual[key].statements).toHaveLength(baseline[key].statements.length);
      actual[key].statements.forEach((query, index) => {
        expect(query.text, `${key}[${index}] text`).toBe(baseline[key].statements[index].text);
        expect(query.params, `${key}[${index}] params`).toEqual(baseline[key].statements[index].params);
        expect(query.text).not.toMatch(/department_id|user_departments/i);
      });
      expect(actual[key].result, `${key} result`).toEqual(baseline[key].result);
    }
    expect(actual).toEqual(baseline);
  });
});
