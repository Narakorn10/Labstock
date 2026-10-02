import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/notifications", () => ({
  notifyUsers: vi.fn(async () => undefined),
  notifyUsersVendorScoped: vi.fn(async () => undefined),
}));

import dbSql from "./db";
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { runDispenseBatch } from "./stock-transactions";

const sql = dbSql as unknown as PgliteSql;
const user = { username: "u1", name: "Tester", role: "User" };
const audit = { userAgent: "test", ipAddress: "127.0.0.1" };

let schemaReady = false;

// R1 lot L1 was received on two different days: round A has 2, round B has 3.
// Lot L2 of the same reagent must never be touched when dispensing lot L1.
async function seed() {
  if (!schemaReady) {
    await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec(`
    TRUNCATE logs, inventory, master_data RESTART IDENTITY CASCADE;
    INSERT INTO master_data (item_id, name, unit, is_active, min_threshold) VALUES ('R1','น้ำยา 1','กล่อง',TRUE,0);
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on) VALUES
      ('R1','L1','2027-01-01',2,'2026-09-01'),
      ('R1','L1','2027-01-01',3,'2026-09-05'),
      ('R1','L2','2026-12-01',9,'2026-09-02');
  `);
}

const stock = async () => (await sql.db.query<{ id: number; quantity: string }>("SELECT id, quantity FROM inventory ORDER BY id")).rows
  .map((row) => `${row.id}=${Number(row.quantity)}`).join(",");
const loggedQty = async () => Number((await sql.db.query<{ n: string }>("SELECT COALESCE(SUM(quantity),0) AS n FROM logs WHERE lot_no = 'L1'")).rows[0].n);

describe("runDispenseBatch across receive rounds of the same lot", () => {
  beforeEach(seed);

  it("takes from the chosen round only when it has enough (behaviour unchanged)", async () => {
    await runDispenseBatch([{ inventoryId: 2, itemId: "R1", lotNo: "L1", qty: 2 }], user, audit);
    expect(await stock()).toBe("1=2,2=1,3=9");
  });

  it("spills into the other round of the same lot when one round is not enough", async () => {
    await runDispenseBatch([{ inventoryId: 1, itemId: "R1", lotNo: "L1", qty: 4 }], user, audit);
    expect(await stock()).toBe("1=0,2=1,3=9");
    expect(await loggedQty()).toBe(4);
  });

  it("dispenses by lot alone when the client sends no inventoryId", async () => {
    await runDispenseBatch([{ itemId: "R1", lotNo: "L1", qty: 5 }], user, audit);
    expect(await stock()).toBe("1=0,2=0,3=9");
  });

  it("fails and changes nothing when the whole lot is not enough", async () => {
    await expect(runDispenseBatch([{ inventoryId: 1, itemId: "R1", lotNo: "L1", qty: 6 }], user, audit)).rejects.toThrow(/REAGENT_STOCK_INSUFFICIENT/);
    expect(await stock()).toBe("1=2,2=3,3=9");
    expect(await loggedQty()).toBe(0);
  });

  it("does not count the same round twice when two cart lines share a lot", async () => {
    await runDispenseBatch([
      { inventoryId: 1, itemId: "R1", lotNo: "L1", qty: 4 },
      { inventoryId: 2, itemId: "R1", lotNo: "L1", qty: 1 },
    ], user, audit);
    expect(await stock()).toBe("1=0,2=0,3=9");
    await expect(runDispenseBatch([{ inventoryId: 1, itemId: "R1", lotNo: "L1", qty: 1 }], user, audit)).rejects.toThrow(/REAGENT_STOCK_INSUFFICIENT|ไม่พบรอบรับเข้า/);
    expect(await stock()).toBe("1=0,2=0,3=9");
  });
});
