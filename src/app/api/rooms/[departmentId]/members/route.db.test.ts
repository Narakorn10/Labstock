import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Room admin tools: members and pending list of the caller's own room. Real (in-memory) Postgres, production schema + v30-v35.

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
  const actual = await vi.importActual<typeof import("@/lib/app-events")>("@/lib/app-events");
  return { ...actual, recordAppEvent: async () => undefined };
});

import { GET as listMembers, POST as addMember } from "./route";
import { DELETE as removeMember } from "./[username]/route";
import { GET as listPending } from "../pending-users/route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

const url = (room: number | string, rest = "members") => `http://localhost/api/rooms/${room}/${rest}`;
const list = (room: number | string) => listMembers(new Request(url(room)), { params: Promise.resolve({ departmentId: String(room) }) });
const add = (room: number | string, body: unknown, headers: Record<string, string> = {}) =>
  addMember(new Request(url(room), { method: "POST", body: JSON.stringify(body), headers }), { params: Promise.resolve({ departmentId: String(room) }) });
const remove = (room: number | string, username: string) =>
  removeMember(new Request(url(room, `members/${username}`), { method: "DELETE" }), { params: Promise.resolve({ departmentId: String(room), username }) });
const pending = (room: number | string) => listPending(new Request(url(room, "pending-users")), { params: Promise.resolve({ departmentId: String(room) }) });
const as = (username: string, role: string, scope: number | "ALL" | null) => {
  h.user = { username, name: username, role, scope };
};
const memberships = async (username: string) =>
  (await db.db.query<{ department_id: number; role: string | null; is_default: boolean }>(
    "SELECT department_id, role, is_default FROM user_departments WHERE username = $1 ORDER BY department_id", [username])).rows;

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
    DELETE FROM user_departments WHERE username IN ('multi', 'pendB', 'pendA', 'susp', 'otheradmin') OR (username = 'solo1' AND department_id = ${DEPT_B}) OR (username = 'newbie') OR (username = 'user1' AND department_id = ${DEPT_B});
    DELETE FROM users WHERE username IN ('multi', 'pendB', 'pendA', 'susp', 'otheradmin');
    UPDATE user_departments SET admin_slot = NULL;
    UPDATE users SET account_status = 'active' WHERE username IN ('solo1', 'solo2', 'newbie', 'user1');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('user1', ${DEPT_B}, 'Operator', false);
    INSERT INTO users (username, password_hash, name, role, account_status) VALUES
      ('multi', 'x', 'Multi', 'User', 'active'), ('pendB', 'x', 'Pending B', 'User', 'pending'), ('pendA', 'x', 'Pending A', 'User', 'pending'),
      ('susp', 'x', 'Suspended', 'User', 'suspended'), ('otheradmin', 'x', 'Other Admin', 'User', 'active');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('multi', ${DEPT_B}, NULL, true), ('multi', ${DEPT_A}, NULL, false),
      ('pendB', ${DEPT_B}, NULL, true), ('pendA', ${DEPT_A}, NULL, true), ('otheradmin', ${DEPT_B}, NULL, true);
    UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo2' AND department_id = ${DEPT_B};
    UPDATE user_departments SET admin_slot = 2 WHERE username = 'otheradmin';
  `);
  as("solo2", "User", DEPT_B);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("who may call", () => {
  it("only a room admin of that room (or a system Admin working in it)", async () => {
    as("solo1", "User", DEPT_A);
    expect((await list(DEPT_A)).status).toBe(403);
    as("manager", "Manager", DEPT_B);
    expect((await list(DEPT_B)).status).toBe(403);
    as("admin1", "Admin", "ALL");
    expect((await list(DEPT_B)).status).toBe(403);
    as("admin1", "Admin", DEPT_B);
    expect((await list(DEPT_B)).status).toBe(200);
    h.user = null;
    expect((await list(DEPT_B)).status).toBe(401);
  });

  it("the URL must name the caller's own room (404), even for a room the caller admins elsewhere", async () => {
    expect((await list(DEPT_A)).status).toBe(404);
    expect((await add(DEPT_A, { username: "newbie" })).status).toBe(404);
    expect((await remove(DEPT_A, "solo1")).status).toBe(404);
    expect((await list("abc")).status).toBe(404);
    expect(await memberships("newbie")).toEqual([]);
  });

  it("flag off: 409 and nothing is written", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    expect((await add(DEPT_B, { username: "newbie" })).status).toBe(409);
    expect(await memberships("newbie")).toEqual([]);
  });

  it("a write from another site is refused", async () => {
    expect((await add(DEPT_B, { username: "newbie" }, { origin: "https://evil.example", host: "localhost" })).status).toBe(403);
    expect(await memberships("newbie")).toEqual([]);
  });
});

describe("list", () => {
  it("members of room B only, room admins first, with the room role and admin flag", async () => {
    const body = await (await list(DEPT_B)).json() as { members: Array<{ username: string; roomRole: string | null; isRoomAdmin: boolean }> };
    const names = body.members.map((m) => m.username);
    expect(names.slice(0, 2)).toEqual(["solo2", "otheradmin"]);
    expect(names).toEqual(expect.arrayContaining(["user1", "multi", "pendB"]));
    expect(names).not.toContain("solo1");
    expect(body.members.find((m) => m.username === "user1")).toMatchObject({ roomRole: "Operator", isRoomAdmin: false });
  });

  it("pending list: only pending ordinary users whose only room is B", async () => {
    await db.db.exec(`INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('susp', ${DEPT_B}, NULL, true)`);
    const body = await (await pending(DEPT_B)).json() as { pending: Array<{ username: string }> };
    expect(body.pending.map((p) => p.username)).toEqual(["pendB"]);
  });
});

describe("add", () => {
  it("adds a person of room A to room B with a role there; their default room stays A", async () => {
    const response = await add(DEPT_B, { username: "solo1", role: "Manager" });
    expect(response.status).toBe(201);
    expect(await memberships("solo1")).toEqual([
      { department_id: DEPT_A, role: null, is_default: true },
      { department_id: DEPT_B, role: "Manager", is_default: false },
    ]);
  });

  it("a person with no room yet gets room B as their default room", async () => {
    expect((await add(DEPT_B, { username: "newbie" })).status).toBe(201);
    expect(await memberships("newbie")).toEqual([{ department_id: DEPT_B, role: null, is_default: true }]);
  });

  it("adding someone who is already a member only changes their role in this room", async () => {
    expect((await add(DEPT_B, { username: "user1", role: "Manager" })).status).toBe(201);
    expect((await memberships("user1")).find((m) => m.department_id === DEPT_B)?.role).toBe("Manager");
    expect((await add(DEPT_B, { username: "user1" })).status).toBe(201);
    expect((await memberships("user1")).find((m) => m.department_id === DEPT_B)?.role).toBeNull();
  });

  it("refuses: a system Admin, a Vendor, a pending or suspended account, an unknown name (same 404, nothing written)", async () => {
    for (const username of ["admin1", "vendor1", "pendA", "susp", "nobody"]) {
      const response = await add(DEPT_B, { username });
      expect(response.status, username).toBe(404);
    }
    expect((await memberships("admin1")).map((m) => m.department_id)).toEqual([DEPT_A]);
    expect((await memberships("vendor1")).map((m) => m.department_id)).toEqual([DEPT_A]);
    expect(await memberships("susp")).toEqual([]);
  });

  it("only User / Operator / Manager can be assigned (Admin, Technician, junk are 400)", async () => {
    for (const role of ["Admin", "Vendor", "Technician", "manager", 5, {}]) {
      expect((await add(DEPT_B, { username: "newbie", role })).status, String(role)).toBe(400);
    }
    expect((await add(DEPT_B, {})).status).toBe(400);
    expect(await memberships("newbie")).toEqual([]);
  });

  it("an inactive room accepts nobody (the room admin's own rights end with the room: 403)", async () => {
    await db.db.exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_B}`);
    try {
      expect((await add(DEPT_B, { username: "newbie" })).status).toBe(403);
    } finally {
      await db.db.exec(`UPDATE departments SET is_active = true WHERE id = ${DEPT_B}`);
    }
    expect(await memberships("newbie")).toEqual([]);
  });
});

describe("remove", () => {
  it("removes a member who has another room", async () => {
    expect((await remove(DEPT_B, "user1")).status).toBe(200);
    expect((await memberships("user1")).map((m) => m.department_id)).toEqual([DEPT_A]);
  });

  it("when the removed room was the default, the remaining room becomes the default", async () => {
    expect((await remove(DEPT_B, "multi")).status).toBe(200);
    expect(await memberships("multi")).toEqual([{ department_id: DEPT_A, role: null, is_default: true }]);
  });

  it("never removes a person's LAST room", async () => {
    expect((await remove(DEPT_B, "pendB")).status).toBe(404);
    expect((await memberships("pendB")).map((m) => m.department_id)).toEqual([DEPT_B]);
  });

  it("never removes a room admin, the caller, a non-member, or someone unknown (same 404)", async () => {
    await db.db.exec(`INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('otheradmin', ${DEPT_A}, NULL, false)`);
    for (const username of ["otheradmin", "solo2", "solo1", "nobody"]) {
      expect((await remove(DEPT_B, username)).status, username).toBe(404);
    }
    expect((await memberships("otheradmin")).map((m) => m.department_id)).toEqual([DEPT_A, DEPT_B]);
    expect((await memberships("solo2")).map((m) => m.department_id)).toEqual([DEPT_B]);
    await db.db.exec(`DELETE FROM user_departments WHERE username = 'otheradmin' AND department_id = ${DEPT_A}`);
  });

  it("a removed person is added back by add (round trip)", async () => {
    expect((await remove(DEPT_B, "user1")).status).toBe(200);
    expect((await add(DEPT_B, { username: "user1", role: "Operator" })).status).toBe(201);
    expect(await memberships("user1")).toEqual([
      { department_id: DEPT_A, role: null, is_default: true },
      { department_id: DEPT_B, role: "Operator", is_default: false },
    ]);
  });
});
