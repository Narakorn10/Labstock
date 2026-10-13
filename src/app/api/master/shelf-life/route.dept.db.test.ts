import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Minimum shelf-life rules per room against a real (in-memory) Postgres with the production schema + v30-v35.

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

import { GET, PATCH } from "./route";
import { findShelfLifeViolations, loadMinShelfLifeRules } from "@/lib/shelf-life";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

const ITEM_A = "A-000002";
const ITEM_B = "MB-000001";

const get = () => GET(new Request("http://localhost/api/master/shelf-life"));
const patch = (itemId: string, minShelfLifeDays: number | null) =>
  PATCH(new Request("http://localhost/api/master/shelf-life", { method: "PATCH", body: JSON.stringify({ itemId, minShelfLifeDays }) }));
const as = (username: string, role: string, scope: number | "ALL" | null) => {
  h.user = { username, name: username, role, scope };
};
const days = async (itemId: string) =>
  (await db.db.query<{ d: number | null }>("SELECT min_shelf_life_days AS d FROM master_data WHERE item_id = $1", [itemId])).rows[0].d;

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(async () => {
  h.target = db as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await db.db.exec(`
    UPDATE master_data SET min_shelf_life_days = NULL;
    UPDATE master_data SET min_shelf_life_days = 30 WHERE item_id = '${ITEM_A}';
    UPDATE master_data SET min_shelf_life_days = 60 WHERE item_id = '${ITEM_B}';
    UPDATE user_departments SET admin_slot = NULL;
  `);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("flag OFF (legacy): unchanged", () => {
  it("GET lists the rules of every room and PATCH can change any item", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    as("manager", "Manager", null);
    expect((await (await get())!.json()).rules).toEqual({ [ITEM_A]: 30, [ITEM_B]: 60 });
    expect((await patch(ITEM_B, 90))!.status).toBe(200);
    expect(await days(ITEM_B)).toBe(90);
  });
});

describe("flag ON", () => {
  it("GET lists only the rules of the user's room", async () => {
    as("manager", "Manager", DEPT_B);
    expect((await (await get())!.json()).rules).toEqual({ [ITEM_B]: 60 });
    as("manager", "Manager", DEPT_A);
    expect((await (await get())!.json()).rules).toEqual({ [ITEM_A]: 30 });
  });

  it("Admin viewing ALL rooms sees every rule but cannot change one (409)", async () => {
    as("admin1", "Admin", "ALL");
    expect((await (await get())!.json()).rules).toEqual({ [ITEM_A]: 30, [ITEM_B]: 60 });
    const response = await patch(ITEM_A, 10);
    expect(response!.status).toBe(409);
    expect(await days(ITEM_A)).toBe(30);
  });

  it("PATCH changes an item of the own room but an item of another room is 'not found' (404) and unchanged", async () => {
    as("manager", "Manager", DEPT_B);
    expect((await patch(ITEM_B, 45))!.status).toBe(200);
    expect(await days(ITEM_B)).toBe(45);
    expect((await patch(ITEM_A, 1))!.status).toBe(404);
    expect(await days(ITEM_A)).toBe(30);
  });

  it("a room admin of room B manages room B rules; an ordinary member is refused", async () => {
    await db.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo2' AND department_id = ${DEPT_B}`);
    as("solo2", "User", DEPT_B);
    expect((await patch(ITEM_B, null))!.status).toBe(200);
    expect(await days(ITEM_B)).toBeNull();
    as("solo1", "User", DEPT_A);
    expect((await get())!.status).toBe(403);
  });
});

describe("loadMinShelfLifeRules", () => {
  it("with a room scope returns only that room's rules; legacy returns all (vendor shipments still pass legacy)", async () => {
    const sql = (await import("@/lib/db")).default;
    expect([...(await loadMinShelfLifeRules(sql, [ITEM_A, ITEM_B], { mode: "one", departmentId: DEPT_B }))]).toEqual([[ITEM_B.toLowerCase(), 60]]);
    expect([...(await loadMinShelfLifeRules(sql, [ITEM_A, ITEM_B], { mode: "legacy" }))].sort()).toEqual([[ITEM_A.toLowerCase(), 30], [ITEM_B.toLowerCase(), 60]]);
    const rules = await loadMinShelfLifeRules(sql, [ITEM_A], { mode: "one", departmentId: DEPT_B });
    expect(findShelfLifeViolations([{ itemId: ITEM_A, lotNo: "L", expDate: "2000-01-01" }], rules)).toEqual([]);
  });
});
