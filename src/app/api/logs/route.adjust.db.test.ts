import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// The Audit Center "ปรับยอด" filter must find every adjustment the system has written (three texts, and the new one
// with details after it) and nothing else. Real in-memory Postgres, production schema, departments off.

const mocks = vi.hoisted(() => ({ hasMenuPermission: vi.fn() }));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ hasMenuPermission: mocks.hasMenuPermission }));

import dbSql from "@/lib/db";
import { applyProdSchema } from "@/test/department-fixtures";
import { ADJUST_FILTER } from "@/lib/stock-adjustment-log";
import { GET } from "./route";

const sql = dbSql as unknown as PgliteSql;

beforeAll(async () => {
  await applyProdSchema(sql.db);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  mocks.hasMenuPermission.mockResolvedValue({ user: { username: "m", name: "M", role: "Manager" }, allowed: true });
  await sql.db.exec(`
    DELETE FROM logs;
    INSERT INTO logs (timestamp, item_id, name, lot_no, action, quantity, username) VALUES
      ('2026-11-01 03:00+00', 'LAB-000001', 'x', 'L1', 'ปรับปรุงยอดสต๊อก (Reconciliation)', 8, 'u'),
      ('2026-11-02 03:00+00', 'LAB-000001', 'x', 'L1', 'ปรับปรุง lot/exp/qty (Reconciliation)', 8, 'u'),
      ('2026-11-03 03:00+00', 'LAB-000001', 'x', 'L1', 'ปรับปรุง lot/exp/qty (Reconciliation) | ยอด 10 → 8 | เหตุผล: นับจริง', 8, 'u'),
      ('2026-11-04 03:00+00', 'LAB-000001', 'x', 'L1', 'ปรับปรุงยอด (Adjustment)', 4, 'u'),
      ('2026-11-05 03:00+00', 'LAB-000001', 'x', 'L1', 'เบิกไปหน้างาน', 2, 'u'),
      ('2026-11-06 03:00+00', 'LAB-000001', 'x', 'L1', 'รับเข้าสต๊อกหลัก', 5, 'u'),
      ('2026-11-07 03:00+00', 'LAB-000001', 'x', 'L1', 'เบิกเติมจากใบงานนับสต็อก', 3, 'u');
  `);
});

const get = async (query: string) =>
  (await (await GET(new Request(`http://localhost/api/logs?limit=50${query}`))).json()) as Array<{ action: string; qty: number }>;

describe("GET /api/logs action filter", () => {
  it("the adjustment filter returns all four adjustment texts and nothing else", async () => {
    const rows = await get(`&action=${encodeURIComponent(ADJUST_FILTER)}`);

    expect(rows.map((row) => row.action).sort()).toEqual([
      "ปรับปรุง lot/exp/qty (Reconciliation)",
      "ปรับปรุง lot/exp/qty (Reconciliation) | ยอด 10 → 8 | เหตุผล: นับจริง",
      "ปรับปรุงยอด (Adjustment)",
      "ปรับปรุงยอดสต๊อก (Reconciliation)",
    ]);
  });

  it("an exact action still matches exactly", async () => {
    const rows = await get(`&action=${encodeURIComponent("เบิกไปหน้างาน")}`);
    expect(rows.map((row) => row.action)).toEqual(["เบิกไปหน้างาน"]);
    expect(await get(`&action=${encodeURIComponent("ปรับปรุงยอดสต๊อก (Reconciliation)")}`)).toHaveLength(1);
  });

  it("no action filter returns everything", async () => {
    expect(await get("")).toHaveLength(7);
  });

  it("the adjustment filter works together with the other filters", async () => {
    const rows = await get(`&action=${encodeURIComponent(ADJUST_FILTER)}&startDate=2026-11-03&endDate=2026-11-03`);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toContain("ยอด 10 → 8");
  });
});
