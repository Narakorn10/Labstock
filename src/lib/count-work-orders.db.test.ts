import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import { confirmCountWorkOrder, CountConfirmError, saveCountWorkOrder } from "./count-work-orders";

const sql = dbSql as unknown as PgliteSql;
const owner = { username: "u1", name: "Tester", role: "User" };
const audit = { userAgent: "test", ipAddress: "127.0.0.1" };

// Slice of the production schema used by the count work-order flow.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS master_data (item_id TEXT PRIMARY KEY, name TEXT, unit TEXT, weekly_target NUMERIC, job_type TEXT, is_active BOOLEAN DEFAULT TRUE);
  CREATE TABLE IF NOT EXISTS inventory (id BIGSERIAL PRIMARY KEY, item_id TEXT, lot_no TEXT, quantity NUMERIC, exp_date DATE, received_on DATE);
  CREATE TABLE IF NOT EXISTS logs (id BIGSERIAL PRIMARY KEY, item_id TEXT, name TEXT, lot_no TEXT, action TEXT, quantity NUMERIC, username TEXT, user_agent TEXT, ip_address TEXT);
  CREATE TABLE IF NOT EXISTS count_work_orders (
    id BIGSERIAL PRIMARY KEY, owner_username TEXT NOT NULL, job_type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), confirmed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, cancelled_by TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS count_work_orders_one_open ON count_work_orders (LOWER(owner_username), job_type) WHERE status = 'OPEN';
  CREATE TABLE IF NOT EXISTS count_work_order_items (
    id BIGSERIAL PRIMARY KEY, work_order_id BIGINT NOT NULL REFERENCES count_work_orders(id), item_id TEXT NOT NULL, name TEXT, unit TEXT,
    weekly_target NUMERIC, counted_qty NUMERIC, required_qty NUMERIC, revision INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (work_order_id, item_id));
  CREATE TABLE IF NOT EXISTS count_work_order_allocations (
    id BIGSERIAL PRIMARY KEY, work_order_item_id BIGINT NOT NULL, inventory_id BIGINT NOT NULL, qty NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (work_order_item_id, inventory_id));
  CREATE TABLE IF NOT EXISTS count_work_order_audit (
    id BIGSERIAL PRIMARY KEY, work_order_id BIGINT, work_order_item_id BIGINT, action TEXT, actor_username TEXT, after_data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
`;

let schemaReady = false;

// R1, R2, R3 each have a weekly target of 10 and one lot with 100 in stock.
// The user counted 4 / 6 / 7, so 6 / 4 / 3 must be dispensed.
async function seedOrder() {
  if (!schemaReady) {
    await sql.db.exec(SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec(`
    TRUNCATE count_work_order_audit, count_work_order_allocations, count_work_order_items, count_work_orders, logs, inventory, master_data RESTART IDENTITY CASCADE;
    INSERT INTO master_data VALUES ('R1','น้ำยา 1','กล่อง',10,'เคมี'), ('R2','น้ำยา 2','กล่อง',10,'เคมี'), ('R3','น้ำยา 3','กล่อง',10,'เคมี');
    INSERT INTO inventory (item_id, lot_no, quantity) VALUES ('R1','L1',100), ('R2','L2',100), ('R3','L3',100);
  `);
  return saveCountWorkOrder(owner, "เคมี", [
    { itemId: "R1", countedQty: 4 }, { itemId: "R2", countedQty: 6 }, { itemId: "R3", countedQty: 7 },
  ]);
}

const alloc = (itemId: string, inventoryId: number, qty: number) => ({ itemId, inventoryId, qty });
const stock = async () => (await sql.db.query<{ item_id: string; quantity: string }>("SELECT item_id, quantity FROM inventory ORDER BY id")).rows
  .map((row) => `${row.item_id}=${Number(row.quantity)}`).join(",");
const status = async (id: number) => (await sql.db.query<{ status: string }>("SELECT status FROM count_work_orders WHERE id = $1", [id])).rows[0].status;
const logCount = async () => Number((await sql.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM logs")).rows[0].n);

const failure = (error: unknown) => {
  expect(error).toBeInstanceOf(CountConfirmError);
  return error as CountConfirmError;
};
const reasons = (failed: Array<{ itemId: string; reason: string }>) => failed.map((item) => `${item.itemId}:${item.reason}`).sort().join(",");

describe("confirmCountWorkOrder (real Postgres)", () => {
  let id: number;
  beforeEach(async () => { id = (await seedOrder()).id; });

  it("confirms an order that needs several items refilled", async () => {
    const result = await confirmCountWorkOrder(owner, id, [alloc("R1", 1, 6), alloc("R2", 2, 4), alloc("R3", 3, 3)], audit);
    expect(result.status).toBe("CONFIRMED");
    expect(result.dispensed.map((item) => item.itemId).sort()).toEqual(["R1", "R2", "R3"]);
    expect(await stock()).toBe("R1=94,R2=96,R3=97");
    expect(await status(id)).toBe("CONFIRMED");
    expect(await logCount()).toBe(3);
  });

  it("dispenses only the requested items and keeps the rest of the order open", async () => {
    const result = await confirmCountWorkOrder(owner, id, [alloc("R2", 2, 4)], audit);
    expect(result.status).toBe("OPEN");
    expect(result.remaining.map((item) => item.itemId).sort()).toEqual(["R1", "R3"]);
    expect(await stock()).toBe("R1=100,R2=96,R3=100");
    expect(await status(id)).toBe("OPEN");

    await confirmCountWorkOrder(owner, id, [alloc("R1", 1, 6), alloc("R3", 3, 3)], audit);
    expect(await stock()).toBe("R1=94,R2=96,R3=97");
    expect(await status(id)).toBe("CONFIRMED");
  });

  it("does not dispense the same item twice when a partial confirm is replayed", async () => {
    await confirmCountWorkOrder(owner, id, [alloc("R2", 2, 4)], audit);
    const error = failure(await confirmCountWorkOrder(owner, id, [alloc("R2", 2, 4)], audit).catch((e) => e));
    expect(reasons(error.failed)).toBe("R2:NOT_PENDING");
    expect(await stock()).toBe("R1=100,R2=96,R3=100");
    expect(await logCount()).toBe(1);
  });

  it("dispenses complete items and reports a quantity that differs from what is required", async () => {
    const result = await confirmCountWorkOrder(owner, id, [alloc("R1", 1, 6), alloc("R2", 2, 3)], audit);
    expect(result.dispensed.map((item) => item.itemId)).toEqual(["R1"]);
    expect(reasons(result.failed)).toBe("R2:QTY_MISMATCH");
    expect(result.remaining.map((item) => item.itemId).sort()).toEqual(["R2", "R3"]);
    expect(await stock()).toBe("R1=94,R2=100,R3=100");
    expect(await status(id)).toBe("OPEN");
  });

  it("throws with the reasons when nothing can be dispensed, without changing stock", async () => {
    const error = failure(await confirmCountWorkOrder(owner, id, [alloc("R1", 1, 5)], audit).catch((e) => e));
    expect(reasons(error.failed)).toBe("R1:QTY_MISMATCH");
    expect(error.remaining).toHaveLength(3);
    expect(await stock()).toBe("R1=100,R2=100,R3=100");
    expect(await status(id)).toBe("OPEN");
  });

  it("rejects an empty confirmation while items still need a refill", async () => {
    const error = failure(await confirmCountWorkOrder(owner, id, [], audit).catch((e) => e));
    expect(error.failed).toHaveLength(0);
    expect(error.remaining).toHaveLength(3);
    expect(await stock()).toBe("R1=100,R2=100,R3=100");
  });

  it("reports items that are not part of the order", async () => {
    const error = failure(await confirmCountWorkOrder(owner, id, [alloc("R9", 1, 6)], audit).catch((e) => e));
    expect(reasons(error.failed)).toBe("R9:NOT_PENDING");
    expect(await stock()).toBe("R1=100,R2=100,R3=100");
  });

  it("reports a lot that belongs to another reagent", async () => {
    const result = await confirmCountWorkOrder(owner, id, [alloc("R1", 2, 6), alloc("R3", 3, 3)], audit);
    expect(reasons(result.failed)).toBe("R1:LOT_INVALID");
    expect(await stock()).toBe("R1=100,R2=100,R3=97");
  });

  it("dispenses the items that still have stock when another lot ran short", async () => {
    await sql.db.exec("UPDATE inventory SET quantity = 2 WHERE id = 3");
    const result = await confirmCountWorkOrder(owner, id, [alloc("R1", 1, 6), alloc("R3", 3, 3)], audit);
    expect(result.dispensed.map((item) => item.itemId)).toEqual(["R1"]);
    expect(result.failed).toEqual([expect.objectContaining({ itemId: "R3", reason: "INSUFFICIENT", requiredQty: 3, available: 2 })]);
    expect(await stock()).toBe("R1=94,R2=100,R3=2");
    expect(await status(id)).toBe("OPEN");
  });

  it("only lets the owner confirm", async () => {
    await expect(confirmCountWorkOrder({ ...owner, username: "someone-else" }, id, [alloc("R1", 1, 6)], audit)).rejects.toThrow("ไม่พบใบงาน");
    expect(await stock()).toBe("R1=100,R2=100,R3=100");
  });

  it("does not re-open a dispensed item when the order is recounted", async () => {
    await confirmCountWorkOrder(owner, id, [alloc("R2", 2, 4)], audit);
    const saved = await saveCountWorkOrder(owner, "เคมี", [{ itemId: "R1", countedQty: 4 }, { itemId: "R2", countedQty: 6 }, { itemId: "R3", countedQty: 7 }]);
    expect(saved.id).toBe(id);
    expect(saved.alreadyDispensed).toEqual(["R2"]);
    const required = (await sql.db.query<{ required_qty: string }>("SELECT required_qty FROM count_work_order_items WHERE item_id = 'R2'")).rows[0].required_qty;
    expect(Number(required)).toBe(0);
    const error = failure(await confirmCountWorkOrder(owner, id, [alloc("R2", 2, 4)], audit).catch((e) => e));
    expect(reasons(error.failed)).toBe("R2:NOT_PENDING");
    expect(await stock()).toBe("R1=100,R2=96,R3=100");
  });

  it("does not keep the order open for a deactivated reagent", async () => {
    await sql.db.exec("UPDATE master_data SET is_active = FALSE WHERE item_id = 'R2'");
    const result = await confirmCountWorkOrder(owner, id, [alloc("R1", 1, 6), alloc("R3", 3, 3)], audit);
    expect(result.message).toBe("ยืนยันเบิกจากใบงานเรียบร้อยแล้ว");
    expect(await stock()).toBe("R1=94,R2=100,R3=97");
    expect(await status(id)).toBe("CONFIRMED");
  });

  it("closes an order whose only remaining item was deactivated, without touching stock", async () => {
    await confirmCountWorkOrder(owner, id, [alloc("R1", 1, 6), alloc("R3", 3, 3)], audit);
    expect(await status(id)).toBe("OPEN");
    await sql.db.exec("UPDATE master_data SET is_active = FALSE WHERE item_id = 'R2'");
    await confirmCountWorkOrder(owner, id, [], audit);
    expect(await status(id)).toBe("CONFIRMED");
    expect(await stock()).toBe("R1=94,R2=100,R3=97");
    expect(await logCount()).toBe(2);
  });

  it("never dispenses a deactivated reagent", async () => {
    await sql.db.exec("UPDATE master_data SET is_active = FALSE WHERE item_id = 'R2'");
    const result = await confirmCountWorkOrder(owner, id, [alloc("R1", 1, 6), alloc("R2", 2, 4), alloc("R3", 3, 3)], audit);
    expect(reasons(result.failed)).toBe("R2:INACTIVE");
    expect(await stock()).toBe("R1=94,R2=100,R3=97");
    expect(await status(id)).toBe("CONFIRMED");
  });

  it("refuses to save a count for a deactivated reagent", async () => {
    await sql.db.exec("UPDATE master_data SET is_active = FALSE WHERE item_id = 'R2'");
    await expect(saveCountWorkOrder(owner, "เคมี", [{ itemId: "R2", countedQty: 1 }])).rejects.toThrow("REAGENT_INACTIVE");
  });
});
