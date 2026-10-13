import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// A room admin approves a pending registrant of THEIR room only. Real (in-memory) Postgres, production schema + v30-v35.

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
vi.mock("@/lib/app-events", async () => {
  // Keep trackRoute's real behavior but do not write app_events rows.
  const actual = await vi.importActual<typeof import("@/lib/app-events")>("@/lib/app-events");
  return { ...actual, recordAppEvent: async () => undefined };
});

import { POST } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

const approve = (room: number | string, username: string, headers: Record<string, string> = {}) =>
  POST(new Request(`http://localhost/api/rooms/${room}/pending-users/${username}/approve`, { method: "POST", headers }), {
    params: Promise.resolve({ departmentId: String(room), username }),
  });
const as = (username: string, role: string, scope: number | "ALL" | null, extra: Record<string, unknown> = {}) => {
  h.user = { username, name: username, role, scope, ...extra };
};
const status = async (username: string) =>
  (await db.db.query<{ account_status: string }>("SELECT account_status FROM users WHERE username = $1", [username])).rows[0].account_status;

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
    DELETE FROM user_departments WHERE username LIKE 'pend%';
    DELETE FROM users WHERE username LIKE 'pend%';
    UPDATE user_departments SET admin_slot = NULL;
    UPDATE users SET account_status = 'active' WHERE username IN ('solo1', 'solo2');
    INSERT INTO users (username, password_hash, name, role, account_status) VALUES
      ('pendB',    'x', 'Pending B',    'User',     'pending'),
      ('pendA',    'x', 'Pending A',    'User',     'pending'),
      ('pendBoth', 'x', 'Pending Both', 'User',     'pending'),
      ('pendNoRoom','x','Pending None',  'User',     'pending'),
      ('pendOp',   'x', 'Pending Op',   'Operator', 'pending'),
      ('pendMgr',  'x', 'Pending Mgr',  'Manager',  'pending'),
      ('pendVend', 'x', 'Pending Vend', 'Vendor',   'pending'),
      ('pendSusp', 'x', 'Suspended',    'User',     'suspended');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('pendB', ${DEPT_B}, NULL, true), ('pendA', ${DEPT_A}, NULL, true),
      ('pendBoth', ${DEPT_B}, NULL, true), ('pendBoth', ${DEPT_A}, NULL, false),
      ('pendOp', ${DEPT_B}, NULL, true), ('pendMgr', ${DEPT_B}, NULL, true),
      ('pendVend', ${DEPT_B}, NULL, true), ('pendSusp', ${DEPT_B}, NULL, true);
    UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo2' AND department_id = ${DEPT_B};
  `);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("room admin of room B", () => {
  beforeEach(() => as("solo2", "User", DEPT_B));

  it("approves an ordinary pending User whose only room is B", async () => {
    const response = await approve(DEPT_B, "pendB");
    expect(response.status).toBe(200);
    expect(await status("pendB")).toBe("active");
  });

  it("matches the username case-insensitively", async () => {
    expect((await approve(DEPT_B, "PENDB")).status).toBe(200);
    expect(await status("pendB")).toBe("active");
  });

  it("answers the same 404 for: other room's registrant, a person who is also in another room, someone with no room, wrong role, suspended, unknown, already active", async () => {
    for (const target of ["pendA", "pendBoth", "pendNoRoom", "pendOp", "pendMgr", "pendVend", "pendSusp", "nobody", "solo1"]) {
      const response = await approve(DEPT_B, target);
      expect(response.status, target).toBe(404);
      expect((await response.json()).code, target).toBe("PENDING_USER_NOT_FOUND");
    }
    expect(await status("pendA")).toBe("pending");
    expect(await status("pendBoth")).toBe("pending");
    expect(await status("pendOp")).toBe("pending");
    expect(await status("pendMgr")).toBe("pending");
    expect(await status("pendVend")).toBe("pending");
    expect(await status("pendSusp")).toBe("suspended");
  });

  it("the URL must name the caller's own room: room A in the URL is 404 even for a pending registrant of A", async () => {
    expect((await approve(DEPT_A, "pendA")).status).toBe(404);
    expect(await status("pendA")).toBe("pending");
    expect((await approve("abc", "pendB")).status).toBe(404);
    expect((await approve(0, "pendB")).status).toBe(404);
  });

  it("a room admin whose own account is not active has no rights (403)", async () => {
    await db.db.exec("UPDATE users SET account_status = 'suspended' WHERE username = 'solo2'");
    expect((await approve(DEPT_B, "pendB")).status).toBe(403);
    expect(await status("pendB")).toBe("pending");
  });

  it("a second approval of the same person is 404 (already active)", async () => {
    expect((await approve(DEPT_B, "pendB")).status).toBe(200);
    expect((await approve(DEPT_B, "pendB")).status).toBe(404);
  });

  it("a room admin whose slot was removed is refused (403) and nothing changes", async () => {
    await db.db.exec("UPDATE user_departments SET admin_slot = NULL");
    expect((await approve(DEPT_B, "pendB")).status).toBe(403);
    expect(await status("pendB")).toBe("pending");
  });

  it("an admin slot in room B does not work while the caller's scope is room A", async () => {
    as("solo2", "User", DEPT_A);
    expect((await approve(DEPT_B, "pendB")).status).toBe(403);
    expect(await status("pendB")).toBe("pending");
  });
});

describe("other callers", () => {
  it("a system Admin working in room B may approve; in 'all rooms' mode may not", async () => {
    as("admin1", "Admin", DEPT_B);
    expect((await approve(DEPT_B, "pendB")).status).toBe(200);
    as("admin1", "Admin", "ALL");
    expect((await approve(DEPT_B, "pendBoth")).status).toBe(403);
  });

  it("an ordinary member, a Manager and an anonymous caller are refused", async () => {
    as("solo1", "User", DEPT_A);
    expect((await approve(DEPT_A, "pendA")).status).toBe(403);
    as("manager", "Manager", DEPT_B);
    expect((await approve(DEPT_B, "pendB")).status).toBe(403);
    h.user = null;
    expect((await approve(DEPT_B, "pendB")).status).toBe(401);
    expect(await status("pendB")).toBe("pending");
  });

  it("a request from another site (Origin header) is refused", async () => {
    as("solo2", "User", DEPT_B);
    const response = await approve(DEPT_B, "pendB", { origin: "https://evil.example", host: "localhost" });
    expect(response.status).toBe(403);
    expect(await status("pendB")).toBe("pending");
  });

  it("flag off: answers 409 DEPARTMENTS_DISABLED and writes nothing", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    as("solo2", "User", DEPT_B);
    const response = await approve(DEPT_B, "pendB");
    expect(response.status).toBe(409);
    expect(await status("pendB")).toBe("pending");
  });
});
