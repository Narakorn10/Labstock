import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Characterization of the reconcile route on the real production schema (departments off = legacy behavior).

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import dbSql from "@/lib/db";
import { applyProdSchema } from "@/test/department-fixtures";
import { POST } from "./route";

const sql = dbSql as unknown as PgliteSql;
const manager = { username: "manager1", name: "Manager One", role: "Manager" };

beforeAll(async () => {
  await applyProdSchema(sql.db);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(manager);
  await sql.db.exec(`
    DELETE FROM logs;
    DELETE FROM inventory;
    INSERT INTO inventory (id, item_id, lot_no, exp_date, quantity, received_on) VALUES
      (101, 'LAB-000001', 'L1', '2027-01-01', 5, '2026-09-01'),
      (102, 'LAB-000001', 'L2', '2027-02-01', 3, '2026-09-01');
  `);
});

function reconcile(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/inventory/reconcile", { method: "POST", body: JSON.stringify(body) }));
}

const base = { inventoryId: 101, itemId: "LAB-000001", newLotNo: "L1-FIXED", newExpDate: "2028-01-01", newQty: 9, expectedQty: 5 };

describe("POST /api/inventory/reconcile (legacy)", () => {
  it("rejects a user who is not Admin or Manager", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "u", name: "U", role: "User" });
    expect((await reconcile(base)).status).toBe(401);
  });

  it("rejects incomplete input", async () => {
    expect((await reconcile({ ...base, newLotNo: "" })).status).toBe(400);
    expect((await reconcile({ ...base, newQty: -1 })).status).toBe(400);
  });

  it("rejects a request without the quantity the user saw (an old page): 400 that asks for a refresh, nothing changes", async () => {
    const withoutExpected: Record<string, unknown> = { ...base };
    delete withoutExpected.expectedQty;
    for (const body of [withoutExpected, { ...base, expectedQty: null }, { ...base, expectedQty: "" }, { ...base, expectedQty: "5" }, { ...base, expectedQty: -1 }]) {
      const response = await reconcile(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json()).error).toContain("รีเฟรช");
    }
    expect(Number((await sql.db.query<{ quantity: string }>("SELECT quantity FROM inventory WHERE id = 101")).rows[0].quantity)).toBe(5);
    expect((await sql.db.query("SELECT 1 FROM logs")).rows).toHaveLength(0);
  });

  it("answers 404 when the inventory row does not match the item", async () => {
    const response = await reconcile({ ...base, itemId: "LAB-000002" });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("LAB-000002");
  });

  it("updates lot, expiry and quantity and writes one log row", async () => {
    const response = await reconcile(base);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: "ปรับ lot, expiry และยอดสต๊อกสำเร็จ" });
    const row = (await sql.db.query<{ lot_no: string; quantity: string; exp_date: Date }>("SELECT lot_no, quantity, exp_date FROM inventory WHERE id = 101")).rows[0];
    expect(row.lot_no).toBe("L1-FIXED");
    expect(Number(row.quantity)).toBe(9);
    const logs = (await sql.db.query<{ action: string; username: string; quantity: string }>("SELECT action, username, quantity FROM logs")).rows;
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("ปรับปรุง lot/exp/qty (Reconciliation) | ยอด 5 → 9 | Lot L1 → L1-FIXED | EXP 2027-01-01 → 2028-01-01");
    expect(logs[0].username).toBe("Manager One (Manager)");
    expect(Number(logs[0].quantity)).toBe(9);
  });

  it("writes the old quantity, only the parts that changed, and the reason into the log", async () => {
    const response = await reconcile({ ...base, newLotNo: "L1", newExpDate: "2027-01-01", newQty: 2, reason: "นับจริง น้ำยาหยดหาย" });

    expect(response.status).toBe(200);
    const logs = (await sql.db.query<{ action: string; quantity: string }>("SELECT action, quantity FROM logs")).rows;
    expect(logs[0].action).toBe("ปรับปรุง lot/exp/qty (Reconciliation) | ยอด 5 → 2 | เหตุผล: นับจริง น้ำยาหยดหาย");
    expect(Number(logs[0].quantity)).toBe(2); // the logged quantity stays the new quantity, as before
  });

  it("cleans the reason: no separator, line breaks or characters that break Telegram/CSV, at most 120 characters", async () => {
    await reconcile({ ...base, newLotNo: "L1", newExpDate: "2027-01-01", reason: "a | b\n<i>\"c\"</i> & " + "ก".repeat(300) });

    const action = (await sql.db.query<{ action: string }>("SELECT action FROM logs")).rows[0].action;
    const reason = action.split(" | เหตุผล: ")[1];
    expect(reason.length).toBeLessThanOrEqual(120);
    expect(reason).not.toMatch(/[|<>&"\n]/);
    expect(action.split(" | ").filter((part) => part.startsWith("ยอด "))).toHaveLength(1);
  });

  it("answers 409 with the current quantity when it changed since the user opened the dialog; nothing is written", async () => {
    await sql.db.exec("UPDATE inventory SET quantity = 4 WHERE id = 101"); // someone dispensed 1

    const response = await reconcile(base); // base.expectedQty is 5

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("เปลี่ยนไปแล้ว");
    expect(body.error).toContain("ปัจจุบัน 4");
    expect(body.currentQty).toBe(4);
    expect(Number((await sql.db.query<{ quantity: string }>("SELECT quantity FROM inventory WHERE id = 101")).rows[0].quantity)).toBe(4);
    expect((await sql.db.query("SELECT 1 FROM logs")).rows).toHaveLength(0);
  });

  it("checks the quantity before the duplicate lot, so a stale page is told to reopen first", async () => {
    await sql.db.exec("UPDATE inventory SET quantity = 4 WHERE id = 101");

    const response = await reconcile({ ...base, newLotNo: "L2" }); // L2 would collide

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("เปลี่ยนไปแล้ว");
  });

  it("still works when the stored quantity has more decimals than a JS number can hold (after decimal dispenses)", async () => {
    await sql.db.exec("UPDATE inventory SET quantity = 100 WHERE id = 101");
    await sql.db.exec("UPDATE inventory SET quantity = quantity - 0.30000000000000004 WHERE id = 101"); // 99.69999999999999996
    const shown = Number((await sql.db.query<{ quantity: string }>("SELECT quantity FROM inventory WHERE id = 101")).rows[0].quantity); // 99.7 on screen

    const response = await reconcile({ ...base, expectedQty: shown, newQty: 50 });

    expect(response.status).toBe(200);
    const log = (await sql.db.query<{ action: string }>("SELECT action FROM logs")).rows[0];
    expect(log.action).toContain("ยอด 99.7 → 50");
    expect(Number((await sql.db.query<{ quantity: string }>("SELECT quantity FROM inventory WHERE id = 101")).rows[0].quantity)).toBe(50);
  });

  it("answers 409 when the new lot collides with another row of the same received_on", async () => {
    const response = await reconcile({ ...base, newLotNo: "L2" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("L2");
    expect((await sql.db.query("SELECT 1 FROM logs")).rows).toHaveLength(0);
  });
});
