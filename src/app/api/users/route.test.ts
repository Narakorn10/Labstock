import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyProdSchema, DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Admin creates a user: flag OFF keeps the legacy insert, flag ON also writes the room in the same statement.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({ target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown) }));

vi.mock("@/lib/db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values),
}));
vi.mock("@/lib/auth-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-utils")>();
  return { ...actual, isAdmin: async () => true };
});

import { POST } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let migrated: PgliteSql;
let legacy: PgliteSql;

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/users", { method: "POST", body: JSON.stringify(body) }));

let n = 0;
const newUser = (extra: Record<string, unknown> = {}) => {
  n += 1;
  return { username: `created${n}`, name: "Created", password: "password-123", role: "User", ...extra };
};

const memberships = async (username: string) =>
  (await migrated.db.query("SELECT department_id, role, is_default FROM user_departments WHERE username = $1", [username])).rows;
const userCount = async (db: PgliteSql, username: string) =>
  Number((await db.db.query<{ c: string }>("SELECT count(*) AS c FROM users WHERE username = $1", [username])).rows[0].c);

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
  legacy = createPgliteSql(new PGlite());
  await applyProdSchema(legacy.db);
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
  await legacy.db.close();
});

beforeEach(() => {
  h.target = migrated as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("flag OFF: unchanged", () => {
  it("creates the user only (also on a database without user_departments)", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    for (const db of [migrated, legacy]) {
      h.target = db as unknown as Impl;
      const body = newUser();
      const response = await post(body);
      expect(response.status).toBe(200);
      expect(await userCount(db, body.username)).toBe(1);
    }
  });
});

describe("flag ON", () => {
  it("defaults to the CC room as the user's default room", async () => {
    const body = newUser();
    expect((await post(body)).status).toBe(200);
    expect(await memberships(body.username)).toEqual([{ department_id: DEPT_A, role: null, is_default: true }]);
  });

  it("uses departmentId when given", async () => {
    const body = newUser({ departmentId: DEPT_B });
    expect((await post(body)).status).toBe(200);
    expect((await memberships(body.username)).map((row) => (row as { department_id: number }).department_id)).toEqual([DEPT_B]);
  });

  it("a bad, unknown or inactive room creates nothing", async () => {
    await migrated.db.exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_B}`);
    for (const departmentId of ["abc", 0, 99999, DEPT_B]) {
      const body = newUser({ departmentId });
      expect((await post(body)).status, String(departmentId)).toBe(400);
      expect(await userCount(migrated, body.username), String(departmentId)).toBe(0);
    }
    await migrated.db.exec(`UPDATE departments SET is_active = true WHERE id = ${DEPT_B}`);
  });

  it("an existing username is rejected and gets no extra membership", async () => {
    const body = newUser();
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(400);
    expect((await memberships(body.username)).length).toBe(1);
  });
});
