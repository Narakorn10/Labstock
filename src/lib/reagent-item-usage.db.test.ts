import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { COUNT_WORK_ORDER_CHILD_DDL, COUNT_WORK_ORDERS_LEGACY_DDL } from "@/test/count-work-order-tables";
import { getReagentItemUsage } from "./reagent-item-usage";

const sql = dbSql as unknown as PgliteSql;
let schemaReady = false;

// R1 has two lots on hand and logs inside and outside 2026-09-01..2026-09-30 (Thai days). R2 is never used.
// 2026-09-20 20:00Z is already 21 Sep in Thailand; 2026-09-30 23:00Z is already 1 Oct.
async function seed() {
  if (!schemaReady) {
    await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
    await sql.db.exec(COUNT_WORK_ORDERS_LEGACY_DDL); // parent first: the child tables reference it
    await sql.db.exec(COUNT_WORK_ORDER_CHILD_DDL);
    schemaReady = true;
  }
  await sql.db.exec(`
    TRUNCATE count_work_order_audit, count_work_order_allocations, count_work_order_items, count_work_orders, logs, inventory, master_data RESTART IDENTITY CASCADE;
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
      ('2026-09-20 20:00+00','R1','L2','เบิกไปหน้างาน',1,'u3'),
      ('2026-09-25 09:00+00','R1','L2','ปรับปรุงยอด (นับสต็อก)',-1,'admin'),
      ('2026-09-30 23:00+00','R1','L2','เบิกไปหน้างาน',4,'u2'),
      ('2026-10-01 00:30+00','R1','L2','เบิกไปหน้างาน',7,'u3'),
      ('2026-09-10 09:00+00','R2','X1','เบิกไปหน้างาน',5,'u1');
  `);
}

describe("getReagentItemUsage", () => {
  beforeEach(seed);

  it("returns null for an unknown item", async () => {
    expect(await getReagentItemUsage("NOPE", "2026-09-01", "2026-09-30", { mode: "legacy" })).toBeNull();
  });

  it("sums only this item's logs inside the date range", async () => {
    const detail = await getReagentItemUsage("R1", "2026-09-01", "2026-09-30", { mode: "legacy" });
    expect(detail?.item).toMatchObject({ itemId: "R1", unit: "กล่อง", quantity: 7, minThreshold: 2, isActive: true });
    expect(detail?.range.days).toBe(30);
    expect(detail?.totals).toMatchObject({ dispensed: 7, received: 10, adjusted: -1, dispenseCount: 4 });
    expect(detail?.totals.averageDailyUsage).toBeCloseTo(7 / 30);
    expect(detail?.totals.lastDispensedAt).toBe("2026-09-20T20:00:00.000Z");
  });

  it("groups dispensing by day, month, lot and user", async () => {
    const detail = await getReagentItemUsage("R1", "2026-09-01", "2026-09-30", { mode: "legacy" });
    expect(detail?.daily).toMatchObject([
      { date: "2026-09-03", qty: 3 },
      { date: "2026-09-20", qty: 3 },
      { date: "2026-09-21", qty: 1 },
    ]);
    expect(detail?.monthly).toMatchObject([{ month: "2026-09", qty: 7 }]);
    expect(detail?.byLot).toEqual([{ lotNo: "L2", qty: 4 }, { lotNo: "L1", qty: 3 }]);
    expect(detail?.byUser).toHaveLength(3);
    expect(detail?.byUser).toEqual(expect.arrayContaining([
      { username: "u1", qty: 5, count: 2 },
      { username: "u2", qty: 1, count: 1 },
      { username: "u3", qty: 1, count: 1 },
    ]));
  });

  it("lists lots still on hand in FEFO order", async () => {
    const detail = await getReagentItemUsage("R1", "2026-09-01", "2026-09-30", { mode: "legacy" });
    expect(detail?.lotsOnHand.map((lot) => `${lot.lotNo}:${lot.expDate}:${lot.quantity}`)).toEqual([
      "L1:2027-01-01:3",
      "L2:2027-03-01:4",
    ]);
  });

  it("handles an item with no usage in range", async () => {
    const detail = await getReagentItemUsage("R2", "2026-09-11", "2026-09-30", { mode: "legacy" });
    expect(detail?.item).toMatchObject({ unit: "หน่วย", isActive: false });
    expect(detail?.totals).toMatchObject({ dispensed: 0, dispenseCount: 0, averageDailyUsage: 0, lastDispensedAt: null });
    expect(detail?.daily).toEqual([]);
    expect(detail?.byLot).toEqual([]);
    expect(detail?.byUser).toEqual([]);
  });
});

const REFILL_RANGE = ["2026-11-03", "2026-11-10"] as const;

// One count work order (departments off) with one item row. 'r1' is lower case on purpose: master_data says 'R1'.
async function seedCount(opts: { status?: string; counted: number; alloc?: number; auditAt?: string; allocAt?: string; itemId?: string }) {
  const itemId = opts.itemId ?? "r1";
  const [order] = (await sql.db.query<{ id: number }>(
    `INSERT INTO count_work_orders (owner_username, job_type, status) VALUES ('counter', '', $1) RETURNING id`,
    [opts.status ?? "CONFIRMED"],
  )).rows;
  const [item] = (await sql.db.query<{ id: number }>(
    `INSERT INTO count_work_order_items (work_order_id, item_id, name, weekly_target, counted_qty, required_qty)
     VALUES ($1, $2, 'น้ำยา 1', 10, $3, 0) RETURNING id`,
    [order.id, itemId, opts.counted],
  )).rows;
  if (opts.alloc) {
    await sql.db.query(
      `INSERT INTO count_work_order_allocations (work_order_item_id, inventory_id, qty, created_at) VALUES ($1, 1, $2, COALESCE($3::timestamptz, NOW()))`,
      [item.id, opts.alloc, opts.allocAt ?? null],
    );
  }
  if (opts.auditAt) {
    await sql.db.query(
      `INSERT INTO count_work_order_audit (work_order_id, work_order_item_id, action, actor_username, created_at) VALUES ($1, $2, 'COUNT_SAVED', 'counter', $3::timestamptz)`,
      [order.id, item.id, opts.auditAt],
    );
  }
}

describe("getReagentItemUsage with count refills (departments off)", () => {
  beforeEach(seed);

  it("adds the refill spread back to the previous count to the regular usage (user example)", async () => {
    await seedCount({ counted: 4, alloc: 6, auditAt: "2026-11-03 02:00+00" });
    await seedCount({ counted: 3, alloc: 7, auditAt: "2026-11-10 02:00+00" });
    await sql.db.exec(`INSERT INTO logs (timestamp, item_id, lot_no, action, quantity, username) VALUES ('2026-11-05 03:00+00','R1','L1','เบิกไปหน้างาน',2,'u1')`);

    const detail = await getReagentItemUsage("R1", ...REFILL_RANGE, { mode: "legacy" });

    expect(detail?.totals).toMatchObject({ dispensed: 2, refill: 7, usage: 9 });
    expect(detail?.totals.averageDailyTotal).toBeCloseTo(9 / 8);
    expect(detail?.totals.averageWeeklyTotal).toBeCloseTo((9 / 8) * 7);
    expect(detail?.daily.map((d) => d.date)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
    expect(detail?.daily.every((d) => d.refill === 1)).toBe(true);
    expect(detail?.daily.find((d) => d.date === "2026-11-05")).toEqual({ date: "2026-11-05", qty: 2, regular: 2, refill: 1, total: 3 });
    expect(detail?.daily.find((d) => d.date === "2026-11-10")).toBeUndefined(); // nothing stacked on the count day
    expect(detail?.monthly).toEqual([{ month: "2026-11", qty: 2, regular: 2, refill: 7, total: 9 }]);
    expect(detail?.lastCountDate).toBe("2026-11-10");
  });

  it("counts a refill of an item with no regular usage at all", async () => {
    await seedCount({ counted: 3, alloc: 7, auditAt: "2026-11-10 02:00+00" });
    const detail = await getReagentItemUsage("R1", ...REFILL_RANGE, { mode: "legacy" });
    expect(detail?.totals).toMatchObject({ dispensed: 0, refill: 7, usage: 7 });
    expect(detail?.daily).toHaveLength(7);
  });

  it("uses the Thai date of the latest COUNT_SAVED as the count date", async () => {
    // 18:00Z on 9 Nov is already 10 Nov in Thailand; an earlier save of the same row must not win.
    await seedCount({ counted: 3, alloc: 7, auditAt: "2026-11-09 18:00+00" });
    await sql.db.exec(`INSERT INTO count_work_order_audit (work_order_id, work_order_item_id, action, actor_username, created_at)
      SELECT work_order_id, id, 'COUNT_SAVED', 'counter', '2026-11-01 02:00+00' FROM count_work_order_items`);
    const detail = await getReagentItemUsage("R1", ...REFILL_RANGE, { mode: "legacy" });
    expect(detail?.totals.refill).toBe(7);
    expect(detail?.daily.map((d) => d.date)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
  });

  it("falls back to the time the stock was taken when there is no COUNT_SAVED audit row", async () => {
    await seedCount({ counted: 3, alloc: 7, allocAt: "2026-11-10 02:00+00" });
    const detail = await getReagentItemUsage("R1", ...REFILL_RANGE, { mode: "legacy" });
    expect(detail?.totals.refill).toBe(7);
    expect(detail?.lastCountDate).toBe("2026-11-10");
  });

  it("sums to the stock taken over the whole spread when the range covers it (ALL-style total)", async () => {
    await seedCount({ counted: 4, alloc: 6, auditAt: "2026-11-03 02:00+00" });
    await seedCount({ counted: 3, alloc: 7, auditAt: "2026-11-10 02:00+00" });
    const detail = await getReagentItemUsage("R1", "2026-10-01", "2026-11-30", { mode: "legacy" });
    expect(detail?.totals.refill).toBe(13);
  });

  it("keeps the rest of the detail and flags refillUnavailable when only the count query fails", async () => {
    await sql.db.exec(`INSERT INTO logs (timestamp, item_id, lot_no, action, quantity, username) VALUES ('2026-11-05 03:00+00','R1','L1','เบิกไปหน้างาน',2,'u1')`);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await sql.db.exec(`ALTER TABLE count_work_order_audit RENAME TO count_work_order_audit_off`);
    try {
      const detail = await getReagentItemUsage("R1", ...REFILL_RANGE, { mode: "legacy" });
      expect(detail?.refillUnavailable).toBe(true);
      expect(detail?.totals).toMatchObject({ dispensed: 2, refill: 0, usage: 2 });
      expect(detail?.lastCountDate).toBeNull();
      expect(detail?.item.itemId).toBe("R1");
      expect(errors.mock.calls.some((call) => /refill/i.test(String(call[0])))).toBe(true);
    } finally {
      await sql.db.exec(`ALTER TABLE count_work_order_audit_off RENAME TO count_work_order_audit`);
      errors.mockRestore();
    }
    expect((await getReagentItemUsage("R1", ...REFILL_RANGE, { mode: "legacy" }))?.refillUnavailable).toBeFalsy();
  });

  it("shows no refill for a count that is only a boundary or has no date", async () => {
    await seedCount({ status: "OPEN", counted: 12 }); // no allocation, no audit, no date: skipped without error
    const detail = await getReagentItemUsage("R1", ...REFILL_RANGE, { mode: "legacy" });
    expect(detail?.totals).toMatchObject({ refill: 0, usage: 0 });
    expect(detail?.lastCountDate).toBeNull();
  });
});
