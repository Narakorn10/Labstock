import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of the bot stock queries (Telegram / LINE webhooks) on the production schema + v30-v34
// (PGlite): with scope { mode: "one" } another department's items and history never come out, including through the OR in
// the search (a barcode that only matches the other department's item). PGlite is not Neon: check on real Neon at rehearsal.

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "@/lib/db";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import type { DepartmentScope } from "@/lib/scoped-db";
import { getLowStockRows, getRecentLogRows, searchStockRows, searchStockRowsByJob } from "./bot-stock-queries";

const sql = dbSql as unknown as PgliteSql;
const scopeA: DepartmentScope = { mode: "one", departmentId: DEPT_A };
const scopeB: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const legacy: DepartmentScope = { mode: "legacy" };
const all: DepartmentScope = { mode: "all" };
const ids = (rows: Array<{ itemId: string }>) => rows.map((row) => row.itemId);

beforeAll(async () => {
  await seedTwoDepartments(sql);
  // One low item per department sharing a name keyword and job type; the barcode of each exists in ONE department only.
  await sql.db.exec(`
    INSERT INTO master_data (item_id, name, unit, barcode, job_type, min_threshold, department_id) VALUES
      ('A-000003', 'Shared keyword gadget', 'box', 'BC-A-111', 'Routine', 10, ${DEPT_A}),
      ('MB-000003', 'Shared keyword widget', 'box', 'BC-SHARED-777', 'Routine', 10, ${DEPT_B});
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('A-000003', 'LA', '2027-01-01', 2, '2026-09-01', ${DEPT_A}),
      ('MB-000003', 'LB', '2027-01-01', 1, '2026-09-01', ${DEPT_B});
  `);
});

afterAll(async () => {
  await sql.db.close();
});

describe("bot stock queries with a department scope", () => {
  it("getRecentLogRows returns only the scoped department's history", async () => {
    const a = await getRecentLogRows(50, scopeA);
    const b = await getRecentLogRows(50, scopeB);
    expect(a.length).toBeGreaterThan(0);
    expect(ids(a).filter((id) => id.startsWith("MB-"))).toEqual([]);
    expect(b.length).toBeGreaterThan(0);
    expect(ids(b).every((id) => id.startsWith("MB-"))).toBe(true);
    // Legacy and "all" keep seeing every department.
    expect((await getRecentLogRows(50, legacy)).length).toBe(a.length + b.length);
    expect((await getRecentLogRows(50, all)).length).toBe(a.length + b.length);
  });

  it("getLowStockRows returns only the scoped department's items", async () => {
    expect(ids(await getLowStockRows(100, scopeA))).toContain("A-000003");
    expect(ids(await getLowStockRows(100, scopeA)).filter((id) => id.startsWith("MB-"))).toEqual([]);
    const lowB = await getLowStockRows(100, scopeB);
    expect(lowB.length).toBeGreaterThan(0);
    expect(ids(lowB).every((id) => id.startsWith("MB-"))).toBe(true);
    // The summed quantity comes from the scoped department's inventory only.
    expect(lowB.find((row) => row.itemId === "MB-000003")?.quantity).toBe("1");
    expect(ids(await getLowStockRows(100, legacy))).toEqual(expect.arrayContaining(["A-000003", "MB-000003"]));
  });

  it("searchStockRows by name stays inside the department", async () => {
    expect(ids(await searchStockRows("Shared keyword", 10, scopeA))).toEqual(["A-000003"]);
    expect(ids(await searchStockRows("Shared keyword", 10, scopeB))).toEqual(["MB-000003"]);
    expect(ids(await searchStockRows("Shared keyword", 10, all))).toEqual(["A-000003", "MB-000003"]);
  });

  it("searchStockRows OR trap: another department's item does not come out by name, id or barcode", async () => {
    // Control: the naive form (AND appended after the OR chain) binds to the barcode term only, so a name or id match of the
    // other department's item still comes out. This is what the parentheses prevent; the test would catch it.
    const naive = await sql`
      SELECT m.item_id FROM master_data m
      WHERE m.item_id ILIKE ${"%widget%"} OR m.name ILIKE ${"%widget%"} OR COALESCE(m.barcode, '') ILIKE ${"%widget%"}
        AND m.department_id = ${DEPT_A}`;
    expect(naive.map((row) => row.item_id)).toEqual(["MB-000003"]);

    expect(await searchStockRows("widget", 10, scopeA)).toEqual([]);
    expect(await searchStockRows("MB-000003", 10, scopeA)).toEqual([]);
    expect(await searchStockRows("BC-SHARED-777", 10, scopeA)).toEqual([]);
    expect(ids(await searchStockRows("BC-SHARED-777", 10, scopeB))).toEqual(["MB-000003"]);
    expect(ids(await searchStockRows("BC-A-111", 10, scopeA))).toEqual(["A-000003"]);
    expect(await searchStockRows("BC-A-111", 10, scopeB)).toEqual([]);
    expect(ids(await searchStockRows("BC-SHARED-777", 10, legacy))).toEqual(["MB-000003"]);
  });

  it("searchStockRowsByJob stays inside the department", async () => {
    const a = ids(await searchStockRowsByJob("Routine", scopeA));
    const b = ids(await searchStockRowsByJob("Routine", scopeB));
    expect(a).toContain("A-000003");
    expect(a.filter((id) => id.startsWith("MB-"))).toEqual([]);
    expect(b).toContain("MB-000003");
    expect(b.filter((id) => !id.startsWith("MB-"))).toEqual([]);
  });

  it("summed quantity ignores inventory rows of the same item_id that sit in another department", async () => {
    // Same item_id, other department: these rows must never be added to the scoped department's total. The test inserts
    // and removes its own rows so nothing leaks into the other tests.
    const qty = (rows: Array<{ itemId: string; quantity: unknown }>, id: string) => String(rows.find((row) => row.itemId === id)?.quantity);
    await sql.db.exec(`
      INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
        ('A-000003', 'LA-IN-B', '2027-01-01', 5, '2026-09-01', ${DEPT_B}),
        ('MB-000003', 'LB-IN-A', '2027-01-01', 4, '2026-09-01', ${DEPT_A});
    `);
    try {
      // Baseline from the seed: A-000003 = 2 in A, MB-000003 = 1 in B (the extra rows would make 7 and 5).
      expect(qty(await getLowStockRows(100, scopeA), "A-000003")).toBe("2");
      expect(qty(await getLowStockRows(100, scopeB), "MB-000003")).toBe("1");
      expect(qty(await searchStockRows("Shared keyword", 10, scopeA), "A-000003")).toBe("2");
      expect(qty(await searchStockRows("Shared keyword", 10, scopeB), "MB-000003")).toBe("1");
      expect(qty(await searchStockRowsByJob("Routine", scopeA), "A-000003")).toBe("2");
      expect(qty(await searchStockRowsByJob("Routine", scopeB), "MB-000003")).toBe("1");
    } finally {
      await sql.db.exec(`DELETE FROM inventory WHERE lot_no IN ('LA-IN-B', 'LB-IN-A');`);
    }
  });

  it("rejects a malformed scope before sending any SQL", async () => {
    const spy = vi.spyOn(sql.db, "query");
    const bad = [undefined, "legacy", { departmentId: DEPT_A }, { mode: "ONE", departmentId: DEPT_A }] as unknown as DepartmentScope[];
    for (const scope of bad) {
      await expect(getRecentLogRows(5, scope)).rejects.toThrow("DepartmentScope");
      await expect(getLowStockRows(5, scope)).rejects.toThrow("DepartmentScope");
      await expect(searchStockRows("x", 5, scope)).rejects.toThrow("DepartmentScope");
      await expect(searchStockRowsByJob("x", scope)).rejects.toThrow("DepartmentScope");
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
