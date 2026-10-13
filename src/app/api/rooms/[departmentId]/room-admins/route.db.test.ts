import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// The system Admin appoints / removes room admins (max 2 per room). Real (in-memory) Postgres, production schema + v30-v35.

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

import { POST as appoint } from "./route";
import { DELETE as unappoint } from "./[username]/route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

const url = (room: number | string, rest = "room-admins") => `http://localhost/api/rooms/${room}/${rest}`;
const add = (room: number | string, body: unknown, headers: Record<string, string> = {}) =>
  appoint(new Request(url(room), { method: "POST", body: JSON.stringify(body), headers }), { params: Promise.resolve({ departmentId: String(room) }) });
const drop = (room: number | string, username: string) =>
  unappoint(new Request(url(room, `room-admins/${username}`), { method: "DELETE" }), { params: Promise.resolve({ departmentId: String(room), username }) });
const as = (username: string, role: string, scope: number | "ALL" | null) => {
  h.user = { username, name: username, role, scope };
};
const slots = async (room: number) =>
  (await db.db.query<{ username: string; admin_slot: number }>(
    "SELECT username, admin_slot FROM user_departments WHERE department_id = $1 AND admin_slot IS NOT NULL ORDER BY admin_slot", [room])).rows;

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
    DELETE FROM user_departments WHERE username LIKE 'cand%';
    DELETE FROM users WHERE username LIKE 'cand%';
    UPDATE user_departments SET admin_slot = NULL;
    UPDATE users SET account_status = 'active', role = 'User' WHERE username IN ('solo1', 'solo2');
    INSERT INTO users (username, password_hash, name, role, account_status) VALUES
      ('cand1', 'x', 'Cand 1', 'User', 'active'), ('cand2', 'x', 'Cand 2', 'Operator', 'active'), ('cand3', 'x', 'Cand 3', 'Manager', 'active'),
      ('candPend', 'x', 'Pending', 'User', 'pending'), ('candSusp', 'x', 'Suspended', 'User', 'suspended');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('cand1', ${DEPT_B}, NULL, true), ('cand2', ${DEPT_B}, NULL, true), ('cand3', ${DEPT_B}, NULL, true),
      ('candPend', ${DEPT_B}, NULL, true), ('candSusp', ${DEPT_B}, NULL, true);
  `);
  as("admin1", "Admin", DEPT_B);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("appoint", () => {
  it("gives the first free slot, then the second, and refuses a third (409, nothing written)", async () => {
    expect((await add(DEPT_B, { username: "cand1" })).status).toBe(201);
    expect((await add(DEPT_B, { username: "cand2" })).status).toBe(201);
    expect(await slots(DEPT_B)).toEqual([{ username: "cand1", admin_slot: 1 }, { username: "cand2", admin_slot: 2 }]);
    const full = await add(DEPT_B, { username: "cand3" });
    expect(full.status).toBe(409);
    expect((await full.json()).error).toContain("ครบ 2 คน");
    expect((await slots(DEPT_B)).length).toBe(2);
  });

  it("a freed slot is reused", async () => {
    await add(DEPT_B, { username: "cand1" });
    await add(DEPT_B, { username: "cand2" });
    expect((await drop(DEPT_B, "cand1")).status).toBe(200);
    expect((await add(DEPT_B, { username: "cand3" })).status).toBe(201);
    expect(await slots(DEPT_B)).toEqual([{ username: "cand3", admin_slot: 1 }, { username: "cand2", admin_slot: 2 }]);
  });

  it("is case-insensitive and says why when it cannot (already admin, not a member, pending, suspended, Vendor, Admin)", async () => {
    expect((await add(DEPT_B, { username: "CAND1" })).status).toBe(201);
    const reasons: Record<string, string> = {
      cand1: "เป็นผู้ดูแลห้องอยู่แล้ว",
      solo1: "ยังไม่เป็นสมาชิก",
      candPend: "ยังไม่ได้อนุมัติ",
      candSusp: "ยังไม่ได้อนุมัติหรือถูกระงับ",
    };
    for (const [username, text] of Object.entries(reasons)) {
      const response = await add(DEPT_B, { username });
      expect(response.status, username).toBe(409);
      expect((await response.json()).error, username).toContain(text);
    }
    await db.db.exec(`UPDATE users SET role = 'Vendor' WHERE username = 'cand3'`);
    expect((await add(DEPT_B, { username: "cand3" })).status).toBe(409);
    expect((await slots(DEPT_B)).map((s) => s.username)).toEqual(["cand1"]);
  });

  it("the same person can be room admin of two rooms", async () => {
    await db.db.exec(`INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('cand1', ${DEPT_A}, NULL, false)`);
    expect((await add(DEPT_B, { username: "cand1" })).status).toBe(201);
    as("admin1", "Admin", DEPT_A);
    expect((await add(DEPT_A, { username: "cand1" })).status).toBe(201);
    expect((await slots(DEPT_A)).map((s) => s.username)).toEqual(["cand1"]);
  });

  it("only a system Admin working in that room: a room admin, a Manager, an Admin in 'all rooms' and anonymous are refused", async () => {
    await db.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo2' AND department_id = ${DEPT_B}`);
    as("solo2", "User", DEPT_B);
    expect((await add(DEPT_B, { username: "cand1" })).status).toBe(403);
    as("manager", "Manager", DEPT_B);
    expect((await add(DEPT_B, { username: "cand1" })).status).toBe(403);
    as("admin1", "Admin", "ALL");
    expect((await add(DEPT_B, { username: "cand1" })).status).toBe(403);
    h.user = null;
    expect((await add(DEPT_B, { username: "cand1" })).status).toBe(401);
    expect((await slots(DEPT_B)).map((s) => s.username)).toEqual(["solo2"]);
  });

  it("the URL must name the Admin's current room (404), bad input is 400, flag off is 409, another site is refused", async () => {
    expect((await add(DEPT_A, { username: "cand1" })).status).toBe(404);
    expect((await add(DEPT_B, {})).status).toBe(400);
    expect((await add(DEPT_B, { username: "x".repeat(81) })).status).toBe(400);
    expect((await add(DEPT_B, { username: "cand1" }, { origin: "https://evil.example", host: "localhost" })).status).toBe(403);
    delete process.env.DEPARTMENTS_ENABLED;
    expect((await add(DEPT_B, { username: "cand1" })).status).toBe(409);
    expect(await slots(DEPT_B)).toEqual([]);
  });

  it("appointing does not change anyone's role or memberships", async () => {
    await add(DEPT_B, { username: "cand2" });
    const user = (await db.db.query<{ role: string }>("SELECT role FROM users WHERE username = 'cand2'")).rows[0];
    expect(user.role).toBe("Operator");
    const memberships = (await db.db.query<{ department_id: number; role: string | null }>("SELECT department_id, role FROM user_departments WHERE username = 'cand2'")).rows;
    expect(memberships).toEqual([{ department_id: DEPT_B, role: null }]);
  });
});

describe("remove", () => {
  it("frees the slot but keeps the person a member", async () => {
    await add(DEPT_B, { username: "cand1" });
    expect((await drop(DEPT_B, "cand1")).status).toBe(200);
    expect(await slots(DEPT_B)).toEqual([]);
    expect((await db.db.query("SELECT 1 FROM user_departments WHERE username = 'cand1' AND department_id = $1", [DEPT_B])).rows.length).toBe(1);
  });

  it("a suspended room admin can still be removed", async () => {
    await add(DEPT_B, { username: "cand1" });
    await db.db.exec(`UPDATE users SET account_status = 'suspended' WHERE username = 'cand1'`);
    expect((await drop(DEPT_B, "cand1")).status).toBe(200);
  });

  it("404 for someone who is not a room admin here; room admins and other callers cannot remove (403)", async () => {
    expect((await drop(DEPT_B, "cand1")).status).toBe(404);
    expect((await drop(DEPT_B, "nobody")).status).toBe(404);
    await add(DEPT_B, { username: "cand1" });
    await db.db.exec(`UPDATE user_departments SET admin_slot = 2 WHERE username = 'solo2' AND department_id = ${DEPT_B}`);
    as("solo2", "User", DEPT_B);
    expect((await drop(DEPT_B, "cand1")).status).toBe(403);
    expect((await slots(DEPT_B)).map((s) => s.username)).toEqual(["cand1", "solo2"]);
  });

  it("only works for the Admin's current room", async () => {
    await add(DEPT_B, { username: "cand1" });
    expect((await drop(DEPT_A, "cand1")).status).toBe(404);
    expect((await slots(DEPT_B)).length).toBe(1);
  });
});
