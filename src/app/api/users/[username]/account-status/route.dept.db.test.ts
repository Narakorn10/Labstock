import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyProdSchema, DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// PATCH /api/users/[username]/account-status per department, against a real in-memory Postgres with the production
// schema + v30-v35. Only a global Admin may call it; a vendor's company is checked in the vendor account's own room.

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
vi.mock("@/lib/auth-utils", () => ({
  getAuthenticatedUser: async () => h.user,
}));

import { PATCH } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;
let legacy: PgliteSql;

const as = (username: string, role: string, scope: number | "ALL" | null, extra: Record<string, unknown> = {}) => {
  h.user = { username, name: username, role, scope, ...extra };
};
const patch = (username: string, accountStatus = "active") =>
  PATCH(
    new Request(`http://localhost/api/users/${username}/account-status`, { method: "PATCH", body: JSON.stringify({ accountStatus }) }),
    { params: Promise.resolve({ username }) },
  );
const statusOf = async (target: PgliteSql, username: string) =>
  (await target.db.query<{ account_status: string }>("SELECT account_status FROM users WHERE username = $1", [username])).rows[0].account_status;

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
  legacy = createPgliteSql(new PGlite());
  await applyProdSchema(legacy.db);
}, 120_000);

afterAll(async () => {
  await db.db.close();
  await legacy.db.close();
});

// Pending vendor accounts (created fresh for every test):
//   tv_a    company 'Vendor A' (approved in room A only)  member of room A
//   tv_mb   company 'MB Vendor' (approved in room B only) member of room A  -> lands in CC, company is B's
//   tv_b    company 'MB Vendor'                           member of room B
//   tv_none company 'Vendor A'                            no membership row
//   tpend   a plain pending User in room A
beforeEach(async () => {
  h.target = db as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await db.db.exec(`
    DELETE FROM user_departments WHERE username LIKE 'tv\\_%' OR username = 'tpend';
    DELETE FROM users WHERE username LIKE 'tv\\_%' OR username = 'tpend';
    UPDATE departments SET is_active = true;
    UPDATE user_departments SET admin_slot = NULL;
    UPDATE vendors SET is_approved = true;
    INSERT INTO users (username, password_hash, name, role, vendor, account_status) VALUES
      ('tv_a', 'x', 'Vendor in A', 'Vendor', 'Vendor A', 'pending'),
      ('tv_mb', 'x', 'Vendor with B company', 'Vendor', 'MB Vendor', 'pending'),
      ('tv_b', 'x', 'Vendor in B', 'Vendor', 'MB Vendor', 'pending'),
      ('tv_none', 'x', 'Vendor without room', 'Vendor', 'Vendor A', 'pending'),
      ('tpend', 'x', 'Pending user', 'User', '', 'pending');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('tv_a', ${DEPT_A}, NULL, true),
      ('tv_mb', ${DEPT_A}, NULL, true),
      ('tv_b', ${DEPT_B}, NULL, true),
      ('tpend', ${DEPT_A}, NULL, true);
  `);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("who may call it", () => {
  it("a global Admin works in room A, room B and ALL, and with a wrong X-Department-Id (departmentDenied)", async () => {
    const callers: Array<[number | "ALL", Record<string, unknown>]> = [
      [DEPT_A, {}],
      [DEPT_B, {}],
      ["ALL", {}],
      [DEPT_A, { departmentDenied: true }],
    ];
    for (const [scope, extra] of callers) {
      await db.db.exec("UPDATE users SET account_status = 'pending' WHERE username = 'tpend'");
      as("admin1", "Admin", scope, extra);
      const response = await patch("tpend");
      expect(response.status, `${scope} ${JSON.stringify(extra)}`).toBe(200);
      expect(await statusOf(db, "tpend")).toBe("active");
    }
  });

  it("a room admin (global User with admin_slot) gets 401 and the status is unchanged", async () => {
    await db.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo1' AND department_id = ${DEPT_A}`);
    as("solo1", "User", DEPT_A);
    const response = await patch("tpend");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(await statusOf(db, "tpend")).toBe("pending");
  });
});

describe("activating a vendor checks the company in the vendor's own room", () => {
  it("vendor in room A with a company approved in A -> 200, whichever room the Admin views", async () => {
    for (const scope of [DEPT_A, DEPT_B, "ALL" as const]) {
      await db.db.exec("UPDATE users SET account_status = 'pending' WHERE username = 'tv_a'");
      as("admin1", "Admin", scope);
      expect((await patch("tv_a")).status, String(scope)).toBe(200);
      expect(await statusOf(db, "tv_a")).toBe("active");
    }
  });

  it("vendor in room B with a company approved in B -> 200 even while the Admin views room A", async () => {
    as("admin1", "Admin", DEPT_A);
    expect((await patch("tv_b")).status).toBe(200);
    expect(await statusOf(db, "tv_b")).toBe("active");
  });

  it("company that exists only in room B while the vendor is in room A -> 400 and the status is unchanged", async () => {
    for (const scope of [DEPT_A, DEPT_B, "ALL" as const]) {
      as("admin1", "Admin", scope);
      const response = await patch("tv_mb");
      expect(response.status, String(scope)).toBe(400);
      expect((await response.json()).error).toContain("ไม่ได้รับอนุมัติในห้องปฏิบัติการของบัญชีนี้");
      expect(await statusOf(db, "tv_mb")).toBe("pending");
    }
  });

  it("a company not approved in the vendor's room (is_approved = false there) -> 400", async () => {
    await db.db.exec(`UPDATE vendors SET is_approved = false WHERE name = 'Vendor A' AND department_id = ${DEPT_A}`);
    as("admin1", "Admin", "ALL");
    const response = await patch("tv_a");
    expect(response.status).toBe(400);
    expect(await statusOf(db, "tv_a")).toBe("pending");
  });

  it("a vendor with no membership row -> 400 (never skips the check) and the status is unchanged", async () => {
    as("admin1", "Admin", "ALL");
    const response = await patch("tv_none");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("ไม่ได้อยู่ในห้องปฏิบัติการที่เปิดใช้งาน");
    expect(await statusOf(db, "tv_none")).toBe("pending");
  });

  it("a vendor whose only room is inactive -> 400", async () => {
    await db.db.exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_B}`);
    as("admin1", "Admin", DEPT_A);
    const response = await patch("tv_b");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("ไม่ได้อยู่ในห้องปฏิบัติการที่เปิดใช้งาน");
    expect(await statusOf(db, "tv_b")).toBe("pending");
  });

  it("uses the default room first, then the lowest id, among the vendor's active rooms", async () => {
    // tv_mb is in A (default). Add B as a non-default room: A still wins, so B's company stays rejected.
    await db.db.exec(`INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('tv_mb', ${DEPT_B}, NULL, false)`);
    as("admin1", "Admin", "ALL");
    expect((await patch("tv_mb")).status).toBe(400);
    // Make B the default room: now the company is checked in B and passes.
    await db.db.exec(`UPDATE user_departments SET is_default = (department_id = ${DEPT_B}) WHERE username = 'tv_mb'`);
    expect((await patch("tv_mb")).status).toBe(200);
    expect(await statusOf(db, "tv_mb")).toBe("active");
  });

  it("suspending a vendor does not run the vendor check", async () => {
    await db.db.exec("UPDATE users SET account_status = 'active' WHERE username = 'tv_none'");
    as("admin1", "Admin", "ALL");
    expect((await patch("tv_none", "suspended")).status).toBe(200);
    expect(await statusOf(db, "tv_none")).toBe("suspended");
  });
});

describe("flag OFF (legacy): unchanged and never mentions department tables", () => {
  it("on a legacy schema without user_departments, an approved vendor is activated and no department SQL is sent", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    const seen: string[] = [];
    h.target = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = legacy(strings, ...values);
        seen.push(query.text);
        return query;
      },
      { unsafe: (text: string) => legacy.unsafe(text), transaction: (queries: never) => legacy.transaction(queries) },
    ) as unknown as Impl;
    await legacy.db.exec(`
      INSERT INTO users (username, password_hash, name, role, vendor, account_status) VALUES
        ('lv_ok', 'x', 'Vendor ok', 'Vendor', 'Vendor A', 'pending'),
        ('lv_bad', 'x', 'Vendor bad', 'Vendor', 'Not A Company', 'pending'),
        ('lu_ok', 'x', 'User ok', 'User', '', 'pending');
    `);
    as("admin1", "Admin", null);

    expect((await patch("lv_ok")).status).toBe(200);
    expect(await statusOf(legacy, "lv_ok")).toBe("active");
    const bad = await patch("lv_bad");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "บริษัทของ Vendor ยังไม่ได้รับอนุมัติ จึงไม่สามารถเปิดใช้งานบัญชีได้" });
    expect(await statusOf(legacy, "lv_bad")).toBe("pending");
    expect((await patch("lu_ok")).status).toBe(200);

    expect(seen.length).toBeGreaterThan(8);
    expect(seen.filter((text) => /department_id|user_departments|departments/i.test(text))).toEqual([]);
  });
});
