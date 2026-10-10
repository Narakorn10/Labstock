import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Characterization tests: lock the current receive/dispense behaviour (legacy schema, no department_id)
// before the stock-scope change. They must keep passing unchanged unless a step intentionally alters them.
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
import { notifyUsers, notifyUsersVendorScoped } from "@/lib/notifications";
import { runDispenseBatch, runReceiveBatch } from "./stock-transactions";

const sql = dbSql as unknown as PgliteSql;
const user = { username: "u1", name: "Tester", role: "User" };
const audit = { userAgent: "test", ipAddress: "127.0.0.1" };

let schemaReady = false;

async function seed() {
  if (!schemaReady) {
    await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
    await sql.db.exec(`
      CREATE TABLE notification_settings (
        username TEXT PRIMARY KEY, email TEXT, line_user_id TEXT, notify_low_stock BOOLEAN DEFAULT FALSE
      );
    `);
    schemaReady = true;
  }
  vi.clearAllMocks();
  await sql.db.exec(`
    TRUNCATE logs, inventory, master_data, users, notification_settings RESTART IDENTITY CASCADE;
    INSERT INTO master_data (item_id, name, unit, is_active, min_threshold) VALUES
      ('R1','น้ำยา 1','กล่อง',TRUE,5),
      ('R2','น้ำยา 2','กล่อง',FALSE,0);
    INSERT INTO users (username, name, role, vendor) VALUES
      ('staff1','Staff 1','User',NULL),
      ('staff2','Staff 2','Manager',NULL),
      ('vend1','Vendor 1','Vendor','V1'),
      ('off1','Off 1','User',NULL);
    INSERT INTO notification_settings (username, email, line_user_id, notify_low_stock) VALUES
      ('staff1','s1@test','Lstaff1',TRUE),
      ('staff2','s2@test','Lstaff2',TRUE),
      ('vend1','v1@test','Lvend1',TRUE),
      ('off1','o1@test','Loff1',FALSE);
  `);
}

const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;
const inventory = () => rows<{ item_id: string; lot_no: string; exp_date: string | null; quantity: string }>(
  "SELECT item_id, lot_no, to_char(exp_date,'YYYY-MM-DD') AS exp_date, quantity FROM inventory ORDER BY id",
);
const logCount = async () => Number((await rows<{ n: string }>("SELECT COUNT(*) AS n FROM logs"))[0].n);

describe("runReceiveBatch characterization", () => {
  beforeEach(seed);

  it("receiving the same lot twice on one day keeps one inventory row with the summed quantity", async () => {
    await runReceiveBatch([{ itemId: "R1", lotNo: "L1", qty: 2, expDate: "2027-01-01" }], user, audit);
    await runReceiveBatch([{ itemId: "R1", lotNo: "L1", qty: 3, expDate: "2027-01-01" }], user, audit);
    const inv = await inventory();
    expect(inv).toHaveLength(1);
    expect(Number(inv[0].quantity)).toBe(5);
  });

  it("a new lot creates a new inventory row", async () => {
    await runReceiveBatch([{ itemId: "R1", lotNo: "L1", qty: 2 }], user, audit);
    await runReceiveBatch([{ itemId: "R1", lotNo: "L2", qty: 4 }], user, audit);
    const inv = await inventory();
    expect(inv.map((r) => `${r.lot_no}=${Number(r.quantity)}`)).toEqual(["L1=2", "L2=4"]);
  });

  it("an empty expiry date does not overwrite the existing exp_date", async () => {
    await runReceiveBatch([{ itemId: "R1", lotNo: "L1", qty: 2, expDate: "2027-01-01" }], user, audit);
    await runReceiveBatch([{ itemId: "R1", lotNo: "L1", qty: 1, expDate: "" }], user, audit);
    const inv = await inventory();
    expect(inv).toHaveLength(1);
    expect(inv[0].exp_date).toBe("2027-01-01");
    expect(Number(inv[0].quantity)).toBe(3);
  });

  it("rejects an inactive reagent with REAGENT_INACTIVE and writes nothing (even for valid lines in the same batch)", async () => {
    const error = await runReceiveBatch([
      { itemId: "R1", lotNo: "L1", qty: 2 },
      { itemId: "R2", lotNo: "L9", qty: 1 },
    ], user, audit).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "REAGENT_INACTIVE", message: "REAGENT_INACTIVE: R2" });
    expect(await inventory()).toEqual([]);
    expect(await logCount()).toBe(0);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("drops lines with qty <= 0 or NaN and writes nothing when none are left", async () => {
    const result = await runReceiveBatch([
      { itemId: "R1", lotNo: "L1", qty: 0 },
      { itemId: "R1", lotNo: "L2", qty: -3 },
      { itemId: "R1", lotNo: "L3", qty: Number.NaN },
    ], user, audit);
    expect(result).toMatchObject({ success: true });
    expect(await inventory()).toEqual([]);
    expect(await logCount()).toBe(0);
    expect(notifyUsers).not.toHaveBeenCalled();

    await runReceiveBatch([
      { itemId: "R1", lotNo: "L1", qty: 0 },
      { itemId: "R1", lotNo: "L2", qty: 2 },
    ], user, audit);
    expect((await inventory()).map((r) => r.lot_no)).toEqual(["L2"]);
  });

  it("writes one log row per received line", async () => {
    await runReceiveBatch([{ itemId: "R1", lotNo: "L1", qty: 2 }], user, audit);
    const logs = await rows<{ item_id: string; lot_no: string; action: string; quantity: string; username: string }>(
      "SELECT item_id, lot_no, action, quantity, username FROM logs",
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ item_id: "R1", lot_no: "L1", action: "รับเข้าสต๊อกหลัก", username: "Tester (User)" });
    expect(Number(logs[0].quantity)).toBe(2);
  });

  it("calls notifyUsers STOCK_RECEIVED with an empty recipient list", async () => {
    await runReceiveBatch([{ itemId: "R1", lotNo: "L1", qty: 2 }], user, audit);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(notifyUsers).toHaveBeenCalledWith(
      "STOCK_RECEIVED",
      expect.objectContaining({ actor: "Tester (User)", items: [expect.objectContaining({ itemId: "R1", lotNo: "L1", qty: 2 })] }),
      [],
    );
  });
});

describe("runDispenseBatch characterization (notifications)", () => {
  beforeEach(seed);

  it("calls notifyUsers STOCK_DISPENSED with an empty recipient list", async () => {
    await sql.db.exec("INSERT INTO inventory (item_id, lot_no, quantity, received_on) VALUES ('R1','L1',20,'2026-09-01')");
    await runDispenseBatch([{ itemId: "R1", lotNo: "L1", qty: 1 }], user, audit);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(notifyUsers).toHaveBeenCalledWith(
      "STOCK_DISPENSED",
      expect.objectContaining({ actor: "Tester (User)", items: [expect.objectContaining({ itemId: "R1", lotNo: "L1", qty: 1 })] }),
      [],
    );
  });

  it("dropping below min_threshold notifies LOW_STOCK to every user with notify_low_stock = true (including the vendor user)", async () => {
    await sql.db.exec("INSERT INTO inventory (item_id, lot_no, quantity, received_on) VALUES ('R1','L1',6,'2026-09-01')");
    await runDispenseBatch([{ itemId: "R1", lotNo: "L1", qty: 2 }], user, audit);

    expect(notifyUsersVendorScoped).toHaveBeenCalledTimes(1);
    const [event, items, recipients] = vi.mocked(notifyUsersVendorScoped).mock.calls[0];
    expect(event).toBe("LOW_STOCK");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemId: "R1", name: "น้ำยา 1" });
    expect(Number((items[0] as unknown as { quantity: unknown }).quantity)).toBe(4);
    expect((recipients as Array<{ username: string }>).map((r) => r.username).sort()).toEqual(["staff1", "staff2", "vend1"]);
    expect(recipients.find((r) => r.username === "vend1")).toMatchObject({ role: "Vendor", vendor: "V1" });
  });

  it("does not send LOW_STOCK while stock stays above min_threshold", async () => {
    await sql.db.exec("INSERT INTO inventory (item_id, lot_no, quantity, received_on) VALUES ('R1','L1',20,'2026-09-01')");
    await runDispenseBatch([{ itemId: "R1", lotNo: "L1", qty: 2 }], user, audit);
    expect(notifyUsersVendorScoped).not.toHaveBeenCalled();
  });
});
