import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyProdSchema } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// A dispense or receipt that lands between the quantity check and the UPDATE of the reconcile route must not be
// overwritten. PGlite has one connection, so the race is made certain with a hook that runs another write right
// before the final statement (after the checks), instead of depending on timing.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  beforeUpdate: null as null | (() => Promise<void>),
  user: { username: "manager1", name: "Manager One", role: "Manager" } as Record<string, unknown>,
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    if (h.beforeUpdate && strings.join("?").includes("WITH updated AS")) {
      const hook = h.beforeUpdate;
      h.beforeUpdate = null;
      return hook().then(() => (h.target as Impl)(strings, ...values));
    }
    return (h.target as Impl)(strings, ...values);
  }) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: async () => h.user }));

import { POST } from "./route";

let db: PgliteSql;

beforeAll(async () => {
  db = createPgliteSql();
  await applyProdSchema(db.db);
  h.target = db as unknown as Impl;
}, 60_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  h.beforeUpdate = null;
  await db.db.exec(`
    DELETE FROM logs;
    DELETE FROM inventory;
    INSERT INTO inventory (id, item_id, lot_no, exp_date, quantity, received_on) VALUES
      (101, 'LAB-000001', 'L1', '2027-01-01', 5, '2026-09-01');
  `);
});

const reconcile = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/inventory/reconcile", { method: "POST", body: JSON.stringify(body) }));
const base = { inventoryId: 101, itemId: "LAB-000001", newLotNo: "L1", newExpDate: "2027-01-01", newQty: 9, expectedQty: 5 };
const qty = async () => Number((await db.db.query<{ quantity: string }>("SELECT quantity FROM inventory WHERE id = 101")).rows[0].quantity);
const logCount = async () => (await db.db.query("SELECT 1 FROM logs")).rows.length;

describe("reconcile route against a write that lands after the check", () => {
  it("a dispense between the check and the UPDATE is not overwritten: 409, nothing written", async () => {
    h.beforeUpdate = () => db.db.exec("UPDATE inventory SET quantity = quantity - 1 WHERE id = 101").then(() => undefined); // 5 -> 4

    const response = await reconcile(base);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.currentQty).toBe(4);
    expect(body.error).toContain("ปัจจุบัน 4");
    expect(await qty()).toBe(4); // the dispense is kept, the adjustment to 9 was not applied
    expect(await logCount()).toBe(0);
  });

  it("a receipt between the check and the UPDATE is not overwritten either", async () => {
    h.beforeUpdate = () => db.db.exec("UPDATE inventory SET quantity = quantity + 6 WHERE id = 101").then(() => undefined); // 5 -> 11

    const response = await reconcile(base);

    expect(response.status).toBe(409);
    expect((await response.json()).currentQty).toBe(11);
    expect(await qty()).toBe(11);
    expect(await logCount()).toBe(0);
  });

  it("after the 409 the user can try again with the refreshed quantity", async () => {
    h.beforeUpdate = () => db.db.exec("UPDATE inventory SET quantity = quantity - 1 WHERE id = 101").then(() => undefined);
    expect((await reconcile(base)).status).toBe(409);

    const retry = await reconcile({ ...base, expectedQty: 4 });

    expect(retry.status).toBe(200);
    expect(await qty()).toBe(9);
    const logs = (await db.db.query<{ action: string }>("SELECT action FROM logs")).rows;
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toContain("ยอด 4 → 9");
  });

  it("a change that leaves the quantity the same (dispense then receipt of the same amount) is not a conflict", async () => {
    h.beforeUpdate = () => db.db.exec("UPDATE inventory SET quantity = quantity - 2 WHERE id = 101; UPDATE inventory SET quantity = quantity + 2 WHERE id = 101;").then(() => undefined);

    expect((await reconcile(base)).status).toBe(200);
    expect(await qty()).toBe(9);
  });

  it("two requests with the same quantity at the same time: one is applied, the other gets 409, one log row", async () => {
    const [first, second] = await Promise.all([reconcile({ ...base, newQty: 9 }), reconcile({ ...base, newQty: 7 })]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const logs = (await db.db.query<{ quantity: string }>("SELECT quantity FROM logs")).rows;
    expect(logs).toHaveLength(1);
    const winner = first.status === 200 ? 9 : 7;
    expect(Number(logs[0].quantity)).toBe(winner);
    expect(await qty()).toBe(winner);
  });
});
