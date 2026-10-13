import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Activating / deactivating an item per room against a real (in-memory) Postgres with the production schema + v30-v35.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  user: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: async () => h.user }));

import { PATCH } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

const ITEM_A = "A-000002";
const ITEM_B = "MB-000001";

const patch = (itemId: string, body: Record<string, unknown>) =>
  PATCH(new Request(`http://localhost/api/master/${itemId}/status`, { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ itemId }),
  });
const as = (username: string, role: string, scope: number | "ALL" | null) => {
  h.user = { username, name: username, role, scope };
};
const isActive = async (itemId: string) =>
  (await db.db.query<{ is_active: boolean }>("SELECT is_active FROM master_data WHERE item_id = $1", [itemId])).rows[0].is_active;

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
  await db.db.exec(`
    CREATE TABLE master_data_status_history (
      id BIGSERIAL PRIMARY KEY, item_id TEXT NOT NULL REFERENCES master_data(item_id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL, reason TEXT, changed_by TEXT, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE purchase_order_items (id SERIAL PRIMARY KEY, po_id INTEGER REFERENCES purchase_orders(id), item_id TEXT);
  `);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(async () => {
  h.target = db as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await db.db.exec(`
    UPDATE master_data SET is_active = true WHERE item_id IN ('${ITEM_A}', '${ITEM_B}');
    DELETE FROM master_data_status_history;
    UPDATE user_departments SET admin_slot = NULL;
  `);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("flag OFF (legacy): unchanged", () => {
  it("a Manager can deactivate any item", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    as("manager", "Manager", null);
    expect((await patch(ITEM_B, { isActive: false, reason: "legacy" }))!.status).toBe(200);
    expect(await isActive(ITEM_B)).toBe(false);
  });
});

describe("flag ON", () => {
  it("room B deactivates its own item and the impact counts only that item's room data", async () => {
    as("manager", "Manager", DEPT_B);
    const response = await patch(ITEM_B, { isActive: false, reason: "no longer used" });
    expect(response!.status).toBe(200);
    expect((await response!.json()).data.impact.stockLotCount).toBe(0);
    expect(await isActive(ITEM_B)).toBe(false);
  });

  it("an item of room A is 'not found' (404): nothing is changed and no history is written", async () => {
    as("manager", "Manager", DEPT_B);
    expect((await patch(ITEM_A, { isActive: false, reason: "hijack" }))!.status).toBe(404);
    expect(await isActive(ITEM_A)).toBe(true);
    expect(Number((await db.db.query<{ c: string }>("SELECT count(*) AS c FROM master_data_status_history")).rows[0].c)).toBe(0);
  });

  it("Admin viewing ALL rooms is read-only (409)", async () => {
    as("admin1", "Admin", "ALL");
    const response = await patch(ITEM_B, { isActive: false, reason: "x" });
    expect(response!.status).toBe(409);
    expect((await response!.json()).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await isActive(ITEM_B)).toBe(true);
  });

  it("a room admin of room B may change room B items; an ordinary member (403) and a room A item (404) are refused", async () => {
    await db.db.exec(`UPDATE user_departments SET admin_slot = 2 WHERE username = 'solo2' AND department_id = ${DEPT_B}`);
    as("solo2", "User", DEPT_B);
    expect((await patch(ITEM_B, { isActive: false, reason: "room admin" }))!.status).toBe(200);
    expect((await patch(ITEM_A, { isActive: false, reason: "room admin" }))!.status).toBe(404);
    as("solo1", "User", DEPT_A);
    expect((await patch(ITEM_A, { isActive: false, reason: "member" }))!.status).toBe(403);
    expect(await isActive(ITEM_A)).toBe(true);
  });

  it("a user who asked for a room they are not in gets 404", async () => {
    h.user = { username: "manager", name: "m", role: "Manager", scope: DEPT_B, departmentDenied: true };
    expect((await patch(ITEM_B, { isActive: false, reason: "x" }))!.status).toBe(404);
  });
});
