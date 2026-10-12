import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { getReagentItemUsage } from "./reagent-item-usage";

const sql = dbSql as unknown as PgliteSql;
let schemaReady = false;

// R1 has two lots on hand and logs inside and outside 2026-09-01..2026-09-30. R2 is never used.
async function seed() {
  if (!schemaReady) {
    await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec(`
    TRUNCATE logs, inventory, master_data RESTART IDENTITY CASCADE;
    INSERT INTO master_data (item_id, name, unit, is_active, min_threshold) VALUES
      ('R1','น้ำยา 1','กล่อง',TRUE,2),
      ('R2','น้ำยา 2',NULL,FALSE,0);
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on) VALUES
      ('R1','L2','2027-03-01',4,'2026-09-02'),
      ('R1','L1','2027-01-01',3,'2026-09-01'),
      ('R1','L0','2026-12-01',0,'2026-08-01'),
      ('R2','X1','2027-01-01',5,'2026-09-01');
    INSERT INTO logs (timestamp, item_id, lot_no, action, quantity, username) VALUES
      ('2026-08-31 10:00+00','R1','L0','เบิกไปหน้างาน',9,'old'),
      ('2026-09-01 08:00+00','R1','L1','รับเข้าสต๊อกหลัก',10,'admin'),
      ('2026-09-03 09:00+00','R1','L1','เบิกไปหน้างาน',2,'u1'),
      ('2026-09-03 15:00+00','R1','L1','เบิกไปหน้างาน',1,'u2'),
      ('2026-09-20 09:00+00','R1','L2','เบิกไปหน้างาน',3,'u1'),
      ('2026-09-25 09:00+00','R1','L2','ปรับปรุงยอด (นับสต็อก)',-1,'admin'),
      ('2026-09-30 23:00+00','R1','L2','เบิกไปหน้างาน',4,'u2'),
      ('2026-10-01 00:30+00','R1','L2','เบิกไปหน้างาน',7,'u3'),
      ('2026-09-10 09:00+00','R2','X1','เบิกไปหน้างาน',5,'u1');
  `);
}

describe("getReagentItemUsage", () => {
  beforeEach(seed);

  it("returns null for an unknown item", async () => {
    expect(await getReagentItemUsage("NOPE", "2026-09-01", "2026-09-30")).toBeNull();
  });

  it("sums only this item's logs inside the date range", async () => {
    const detail = await getReagentItemUsage("R1", "2026-09-01", "2026-09-30");
    expect(detail?.item).toMatchObject({ itemId: "R1", unit: "กล่อง", quantity: 7, minThreshold: 2, isActive: true });
    expect(detail?.range.days).toBe(30);
    expect(detail?.totals).toMatchObject({ dispensed: 10, received: 10, adjusted: -1, dispenseCount: 4 });
    expect(detail?.totals.averageDailyUsage).toBeCloseTo(10 / 30);
    expect(detail?.totals.lastDispensedAt).toBe("2026-09-30T23:00:00.000Z");
  });

  it("groups dispensing by day, month, lot and user", async () => {
    const detail = await getReagentItemUsage("R1", "2026-09-01", "2026-09-30");
    expect(detail?.daily).toEqual([
      { date: "2026-09-03", qty: 3 },
      { date: "2026-09-20", qty: 3 },
      { date: "2026-09-30", qty: 4 },
    ]);
    expect(detail?.monthly).toEqual([{ month: "2026-09", qty: 10 }]);
    expect(detail?.byLot).toEqual([{ lotNo: "L2", qty: 7 }, { lotNo: "L1", qty: 3 }]);
    expect(detail?.byUser).toHaveLength(2);
    expect(detail?.byUser).toEqual(expect.arrayContaining([
      { username: "u1", qty: 5, count: 2 },
      { username: "u2", qty: 5, count: 2 },
    ]));
  });

  it("lists lots still on hand in FEFO order", async () => {
    const detail = await getReagentItemUsage("R1", "2026-09-01", "2026-09-30");
    expect(detail?.lotsOnHand.map((lot) => `${lot.lotNo}:${lot.expDate}:${lot.quantity}`)).toEqual([
      "L1:2027-01-01:3",
      "L2:2027-03-01:4",
    ]);
  });

  it("handles an item with no usage in range", async () => {
    const detail = await getReagentItemUsage("R2", "2026-09-11", "2026-09-30");
    expect(detail?.item).toMatchObject({ unit: "หน่วย", isActive: false });
    expect(detail?.totals).toMatchObject({ dispensed: 0, dispenseCount: 0, averageDailyUsage: 0, lastDispensedAt: null });
    expect(detail?.daily).toEqual([]);
    expect(detail?.byLot).toEqual([]);
    expect(detail?.byUser).toEqual([]);
  });
});
