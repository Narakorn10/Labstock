import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";
import type { AuthenticatedUser } from "@/lib/auth-utils";

// Room admin checks against a real (in-memory) Postgres with the production schema + v30-v35.

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  texts: [] as string[],
}));

vi.mock("./db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.texts.push(strings.join("?"));
    return (h.target as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(strings, ...values);
  },
}));

import { resetDepartmentsFlagForTests } from "./departments-flag";
import { hasRoomAdminSlot, requireRoomSettingsAccess } from "./room-admin";

let migrated: PgliteSql;

const user = (username: string, extra: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({ username, name: username, role: "User", ...extra });

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
});

beforeEach(async () => {
  h.texts = [];
  h.target = migrated as unknown as typeof h.target;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await migrated.db.exec(`
    UPDATE user_departments SET admin_slot = NULL;
    UPDATE users SET account_status = 'active';
    UPDATE users SET role = 'User' WHERE username = 'solo1';
    UPDATE departments SET is_active = true;
    UPDATE departments SET code = 'MB' WHERE id = ${DEPT_B};
  `);
});

describe("hasRoomAdminSlot", () => {
  it("flag off: false with zero SQL calls", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).toBe(false);
    expect(h.texts).toEqual([]);
  });

  it("true only for the room where the user holds a slot", async () => {
    await migrated.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo1' AND department_id = ${DEPT_A}`);
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).toBe(true);
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_B)).toBe(false);
    expect(await hasRoomAdminSlot({ username: "solo2" }, DEPT_A)).toBe(false);
  });

  it("a slot in one room does not make the user admin of their other room", async () => {
    await migrated.db.exec(`UPDATE user_departments SET admin_slot = 2 WHERE username = 'user1' AND department_id = ${DEPT_B}`);
    expect(await hasRoomAdminSlot({ username: "user1" }, DEPT_B)).toBe(true);
    expect(await hasRoomAdminSlot({ username: "user1" }, DEPT_A)).toBe(false);
  });

  it("a suspended account, a Vendor, an inactive room and a room without a code all lose it immediately", async () => {
    await migrated.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo1' AND department_id = ${DEPT_A}`);
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).toBe(true);

    await migrated.db.exec(`UPDATE users SET account_status = 'suspended' WHERE username = 'solo1'`);
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).toBe(false);
    await migrated.db.exec(`UPDATE users SET account_status = 'active' WHERE username = 'solo1'`);

    await migrated.db.exec(`UPDATE users SET role = 'Vendor' WHERE username = 'solo1'`);
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).toBe(false);
    await migrated.db.exec(`UPDATE users SET role = 'User' WHERE username = 'solo1'`);

    await migrated.db.exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_A}`);
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).toBe(false);
    await migrated.db.exec(`UPDATE departments SET is_active = true WHERE id = ${DEPT_A}`);

    await migrated.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo2' AND department_id = ${DEPT_B}`);
    expect(await hasRoomAdminSlot({ username: "solo2" }, DEPT_B)).toBe(true);
    await migrated.db.exec(`UPDATE departments SET code = NULL WHERE id = ${DEPT_B}`);
    expect(await hasRoomAdminSlot({ username: "solo2" }, DEPT_B)).toBe(false);
  });

  it("rejects an invalid department id without touching the database", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(await hasRoomAdminSlot({ username: "solo1" }, bad)).toBe(false);
    expect(h.texts).toEqual([]);
  });

  it("reads fresh every time (removing the slot takes effect on the next call)", async () => {
    await migrated.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo1'`);
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).toBe(true);
    await migrated.db.exec(`UPDATE user_departments SET admin_slot = NULL WHERE username = 'solo1'`);
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).toBe(false);
  });

  it("v35 not applied (missing column): false, not an error", async () => {
    // Fail only the slot query (as Postgres would with SQLSTATE 42703); the readiness probe keeps working.
    h.target = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("?").includes("admin_slot")) return Promise.reject(Object.assign(new Error("undefined column"), { code: "42703" }));
      return (migrated as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(strings, ...values);
    }) as unknown as typeof h.target;
    expect(await hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).toBe(false);
  });

  it("other database errors are thrown, not turned into false", async () => {
    h.target = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("?").includes("admin_slot")) return Promise.reject(Object.assign(new Error("boom"), { code: "57P01" }));
      return (migrated as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(strings, ...values);
    }) as unknown as typeof h.target;
    await expect(hasRoomAdminSlot({ username: "solo1" }, DEPT_A)).rejects.toThrow("boom");
  });
});

describe("requireRoomSettingsAccess", () => {
  it("system Admin: allowed in the selected room, read-only for scope ALL, legacy gives departmentId null", async () => {
    expect(await requireRoomSettingsAccess(user("admin1", { role: "Admin", scope: DEPT_B }))).toEqual({ ok: true, via: "admin", departmentId: DEPT_B });
    expect(await requireRoomSettingsAccess(user("admin1", { role: "Admin", scope: "ALL" }))).toEqual({ ok: false, reason: "select-department" });
    expect(await requireRoomSettingsAccess(user("admin1", { role: "Admin", scope: null }))).toEqual({ ok: true, via: "admin", departmentId: null });
  });

  it("room admin: allowed only in the room of the scope", async () => {
    await migrated.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo1' AND department_id = ${DEPT_A}`);
    expect(await requireRoomSettingsAccess(user("solo1", { scope: DEPT_A }))).toEqual({ ok: true, via: "room-admin", departmentId: DEPT_A });
    expect(await requireRoomSettingsAccess(user("solo1", { scope: DEPT_B }))).toEqual({ ok: false, reason: "forbidden" });
  });

  it("an ordinary member, scope ALL/null, and a denied department are forbidden", async () => {
    expect(await requireRoomSettingsAccess(user("solo1", { scope: DEPT_A }))).toEqual({ ok: false, reason: "forbidden" });
    await migrated.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo1'`);
    expect(await requireRoomSettingsAccess(user("solo1", { scope: null }))).toEqual({ ok: false, reason: "forbidden" });
    expect(await requireRoomSettingsAccess(user("solo1", { scope: "ALL" }))).toEqual({ ok: false, reason: "forbidden" });
    expect(await requireRoomSettingsAccess(user("solo1", { scope: DEPT_A, departmentDenied: true }))).toEqual({ ok: false, reason: "forbidden" });
    expect(await requireRoomSettingsAccess(user("admin1", { role: "Admin", scope: DEPT_A, departmentDenied: true }))).toEqual({ ok: false, reason: "forbidden" });
  });

  it("flag off: a room admin gets nothing, a system Admin still works (legacy)", async () => {
    await migrated.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo1'`);
    delete process.env.DEPARTMENTS_ENABLED;
    expect(await requireRoomSettingsAccess(user("solo1", { scope: DEPT_A }))).toEqual({ ok: false, reason: "forbidden" });
    expect(await requireRoomSettingsAccess(user("admin1", { role: "Admin" }))).toEqual({ ok: true, via: "admin", departmentId: null });
  });
});
