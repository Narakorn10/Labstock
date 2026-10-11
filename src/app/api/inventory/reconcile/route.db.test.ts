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

const base = { inventoryId: 101, itemId: "LAB-000001", newLotNo: "L1-FIXED", newExpDate: "2028-01-01", newQty: 9 };

describe("POST /api/inventory/reconcile (legacy)", () => {
  it("rejects a user who is not Admin or Manager", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "u", name: "U", role: "User" });
    expect((await reconcile(base)).status).toBe(401);
  });

  it("rejects incomplete input", async () => {
    expect((await reconcile({ ...base, newLotNo: "" })).status).toBe(400);
    expect((await reconcile({ ...base, newQty: -1 })).status).toBe(400);
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
    expect(logs[0].action).toBe("ปรับปรุง lot/exp/qty (Reconciliation)");
    expect(logs[0].username).toBe("Manager One (Manager)");
    expect(Number(logs[0].quantity)).toBe(9);
  });

  it("answers 409 when the new lot collides with another row of the same received_on", async () => {
    const response = await reconcile({ ...base, newLotNo: "L2" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("L2");
    expect((await sql.db.query("SELECT 1 FROM logs")).rows).toHaveLength(0);
  });
});
