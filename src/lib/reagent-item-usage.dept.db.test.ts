import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) scoping of the Analysis "per reagent" detail on the production schema + v30-v34 (PGlite).

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import type { DepartmentScope } from "./scoped-db";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { getReagentItemUsage } from "./reagent-item-usage";

const sql = dbSql as unknown as PgliteSql;
const ONE_A: DepartmentScope = { mode: "one", departmentId: DEPT_A };
const ONE_B: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const ALL: DepartmentScope = { mode: "all" };
const LEGACY: DepartmentScope = { mode: "legacy" };

const DISPENSE = "เบิกไปหน้างาน";
const RECEIVE = "รับเข้าสต๊อกหลัก";
const ITEM = "MB-000001"; // belongs to department B

const dayOffset = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const DAY_B1 = dayOffset(3);
const DAY_B2 = dayOffset(2);
const DAY_A = dayOffset(4); // department A's mismatched rows sit on a day B never uses
const START = dayOffset(10);
const END = dayOffset(0);

beforeAll(async () => {
  await seedTwoDepartments(sql);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

// Department B (owner of MB-000001): lot LB1 qty 7, dispensed 2 + 3 by bob, received 10.
// Department A mismatched rows sharing the same item_id: lot LX9 qty 99, dispensed 50 by alice, received 100.
beforeEach(async () => {
  await sql.db.exec(`
    TRUNCATE logs, inventory RESTART IDENTITY CASCADE;
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('${ITEM}', 'LB1', '2027-01-01', 7, '2026-09-01', ${DEPT_B}),
      ('${ITEM}', 'LX9', '2027-02-01', 99, '2026-09-01', ${DEPT_A});
    INSERT INTO logs (timestamp, item_id, lot_no, action, quantity, username, department_id) VALUES
      ('${DAY_B1} 12:00+00', '${ITEM}', 'LB1', '${DISPENSE}', 2, 'bob', ${DEPT_B}),
      ('${DAY_B2} 12:00+00', '${ITEM}', 'LB1', '${DISPENSE}', 3, 'bob', ${DEPT_B}),
      ('${DAY_B1} 08:00+00', '${ITEM}', 'LB1', '${RECEIVE}', 10, 'bob', ${DEPT_B}),
      ('${DAY_A} 12:00+00', '${ITEM}', 'LX9', '${DISPENSE}', 50, 'alice', ${DEPT_A}),
      ('${DAY_A} 08:00+00', '${ITEM}', 'LX9', '${RECEIVE}', 100, 'alice', ${DEPT_A});
  `);
});

const usage = (scope: DepartmentScope, itemId = ITEM) => getReagentItemUsage(itemId, START, END, scope);

describe("getReagentItemUsage with a department scope", () => {
  it("returns only department B data in every field for a department B user", async () => {
    const detail = await usage(ONE_B);

    expect(detail).not.toBeNull();
    expect(detail!.item.quantity).toBe(7);
    expect(detail!.totals).toMatchObject({ dispensed: 5, received: 10, adjusted: 0, dispenseCount: 2 });
    expect(detail!.reorder.dispensedLast90Days).toBe(5);
    expect(detail!.daily).toEqual([{ date: DAY_B1, qty: 2 }, { date: DAY_B2, qty: 3 }]);
    expect(detail!.monthly.reduce((sum, m) => sum + m.qty, 0)).toBe(5);
    expect(detail!.byLot).toEqual([{ lotNo: "LB1", qty: 5 }]);
    expect(detail!.byUser).toEqual([{ username: "bob", qty: 5, count: 2 }]);
    expect(detail!.lotsOnHand.map((l) => [l.lotNo, l.quantity])).toEqual([["LB1", 7]]);

    const text = JSON.stringify(detail);
    expect(text).not.toContain("alice");
    expect(text).not.toContain("LX9");
    expect(text).not.toContain(DAY_A);
  });

  it("answers null for a department A user asking for a department B item, like an unknown id", async () => {
    expect(await usage(ONE_A)).toBeNull();
    expect(await usage(ONE_A, "NOPE-000000")).toBeNull();
  });

  it("includes the mismatched department A rows in mode all (intentional)", async () => {
    const detail = await usage(ALL);

    expect(detail!.item.quantity).toBe(106);
    expect(detail!.totals).toMatchObject({ dispensed: 55, received: 110, dispenseCount: 3 });
    expect(detail!.reorder.dispensedLast90Days).toBe(55);
    expect(detail!.daily.map((d) => d.date)).toEqual([DAY_A, DAY_B1, DAY_B2]);
    expect(detail!.byLot.map((l) => l.lotNo)).toEqual(["LX9", "LB1"]);
    expect(detail!.byUser.map((u) => u.username)).toEqual(["alice", "bob"]);
    expect(detail!.lotsOnHand.map((l) => l.lotNo).sort()).toEqual(["LB1", "LX9"]);
  });

  it("legacy mode on the multi-department schema behaves like all", async () => {
    expect(await usage(LEGACY)).toEqual(await usage(ALL));
  });
});
