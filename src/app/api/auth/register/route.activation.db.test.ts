import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// End to end: sign-up (real register route) puts a vendor in the company's room, then a global Admin can activate it
// (real account-status route). Only the database (onto PGlite) and auth are mocked.

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
vi.mock("@/lib/auth-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-utils")>()),
  getAuthenticatedUser: async () => h.user,
}));

import { POST } from "./route";
import { PATCH } from "../../users/[username]/account-status/route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(async () => {
  h.target = db as unknown as Impl;
  await db.db.exec(`UPDATE departments SET is_active = true; UPDATE departments SET code = 'MB' WHERE id = ${DEPT_B}`);
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.DEPARTMENTS_ENABLED;
  resetDepartmentsFlagForTests();
  vi.restoreAllMocks();
});

describe("sign-up then activation", () => {
  it("a vendor who signs up for a room-B-only company can be activated by an Admin", async () => {
    const username = "e2evendorb";
    const signUp = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: "E2E Vendor",
          email: "e2evendorb@example.com",
          username,
          password: "a-long-password-123",
          accountType: "vendor",
          vendorMode: "existing",
          vendorName: "mb vendor",
        }),
      }),
    );
    expect(signUp.status).toBe(201);

    const rooms = await db.db.query("SELECT department_id, is_default FROM user_departments WHERE username = $1", [username]);
    expect(rooms.rows).toEqual([{ department_id: DEPT_B, is_default: true }]);

    h.user = { username: "admin1", name: "admin1", role: "Admin", scope: "ALL" };
    const activate = await PATCH(
      new Request(`http://localhost/api/users/${username}/account-status`, { method: "PATCH", body: JSON.stringify({ accountStatus: "active" }) }),
      { params: Promise.resolve({ username }) },
    );
    expect(activate.status).toBe(200);
    const row = await db.db.query<{ account_status: string }>("SELECT account_status FROM users WHERE username = $1", [username]);
    expect(row.rows[0].account_status).toBe("active");
  });
});
