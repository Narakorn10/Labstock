import crypto from "crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyProdSchema, expectOnlyDepartment, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Department-aware authentication against a real (in-memory) Postgres with the production schema.
// `sql` is a thin spy in front of two databases: a LEGACY one (production schema, no v30-v34) and a MIGRATED one.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  texts: [] as string[],
  failWhen: null as null | ((text: string) => boolean),
  failCode: "42703",
  auth: vi.fn(),
}));

vi.mock("./db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    h.texts.push(text);
    if (h.failWhen?.(text)) return Promise.reject(Object.assign(new Error("undefined column"), { code: h.failCode }));
    return (h.target as Impl)(strings, ...values);
  },
}));
vi.mock("@/auth", () => ({ auth: h.auth }));

import { getAuthenticatedUser } from "./auth-utils";
import { isCurrentAuthSession } from "./auth-service";
import { effectiveRole, resetDepartmentContextForTests } from "./department-context";
import { resetDepartmentsFlagForTests } from "./departments-flag";

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const selectCount = () => h.texts.filter((text) => /^\s*SELECT/i.test(text)).length;
const mentionsDepartments = () => h.texts.some((text) => /user_departments|department_id|item_code|departments/i.test(text));

let legacy: PgliteSql;
let migrated: PgliteSql;
let warn: ReturnType<typeof vi.spyOn>;

function selectDb(db: PgliteSql) {
  h.target = db as unknown as Impl;
}

function sessionAs(username: string, extra: Record<string, unknown> = {}, role = "User", sessionVersion = 1) {
  h.auth.mockResolvedValue({ user: { username, name: username, role, vendor: "", sessionVersion, ...extra } });
}

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/x", { headers });
const bearer = (token: string, extra: Record<string, string> = {}) => req({ Authorization: `Bearer ${token}`, ...extra });

beforeAll(async () => {
  legacy = createPgliteSql(new PGlite());
  await applyProdSchema(legacy.db);
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
  for (const db of [legacy, migrated]) {
    await db.db.exec(`
      UPDATE users SET token = 'tok-' || username WHERE username <> 'solo2';
      UPDATE users SET token = '${sha256("raw-solo2")}' WHERE username = 'solo2';
    `);
  }
  await legacy.db.exec(`INSERT INTO users (username, password_hash, name, role, token) VALUES ('newbie', 'x', 'No Membership', 'User', 'tok-newbie')`);
}, 120_000);

afterAll(async () => {
  await legacy.db.close();
  await migrated.db.close();
});

beforeEach(() => {
  h.texts = [];
  h.failWhen = null;
  h.failCode = "42703";
  h.auth.mockReset();
  h.auth.mockResolvedValue(null);
  resetDepartmentsFlagForTests();
  resetDepartmentContextForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  delete process.env.DEPARTMENTS_ENABLED;
});

afterEach(() => {
  delete process.env.DEPARTMENTS_ENABLED;
  warn.mockRestore();
});

describe("flag OFF (DEPARTMENTS_ENABLED unset): identical to the legacy behavior", () => {
  it("session path: same result, exactly 2 queries, none mentions departments (legacy and migrated DB alike)", async () => {
    for (const db of [legacy, migrated]) {
      selectDb(db);
      h.texts = [];
      sessionAs("user1", { vendor: "V" }, "User", 1);
      const user = await getAuthenticatedUser(req({ "X-Department-Id": "2" }));
      expect(user).toStrictEqual({ username: "user1", name: "user1", role: "User", vendor: "V" });
      expect(selectCount()).toBe(2); // getLoginSchemaState + session check, as before
      expect(mentionsDepartments()).toBe(false);
    }
  });

  it("session path: stale session version is still rejected with the same 2 queries", async () => {
    selectDb(migrated);
    sessionAs("user1", {}, "User", 99);
    await expect(getAuthenticatedUser(req())).resolves.toBeNull();
    expect(selectCount()).toBe(2);
  });

  it("bearer path: same result, exactly 2 queries, header ignored, no department columns touched", async () => {
    for (const db of [legacy, migrated]) {
      selectDb(db);
      h.texts = [];
      const user = await getAuthenticatedUser(bearer("tok-user1", { "X-Department-Id": "2" }));
      expect(user).toStrictEqual({ username: "user1", name: "User One", role: "User", vendor: "" });
      expect(selectCount()).toBe(2); // column probe + user select, as before
      expect(mentionsDepartments()).toBe(false);
    }
  });

  it("isCurrentAuthSession keeps its 2 queries", async () => {
    selectDb(migrated);
    await expect(isCurrentAuthSession("user1", 1)).resolves.toBe(true);
    expect(selectCount()).toBe(2);
    expect(mentionsDepartments()).toBe(false);
  });

  it("flag set to anything but 'true' is off", async () => {
    selectDb(migrated);
    process.env.DEPARTMENTS_ENABLED = "1";
    const user = await getAuthenticatedUser(bearer("tok-user1"));
    expect(user).toStrictEqual({ username: "user1", name: "User One", role: "User", vendor: "" });
    expect(selectCount()).toBe(2);
  });
});

describe("flag ON but the department tables do not exist yet: legacy behavior + one warning", () => {
  it("returns the legacy result, costs one extra readiness probe once per minute, and warns once", async () => {
    selectDb(legacy);
    process.env.DEPARTMENTS_ENABLED = "true";

    const first = await getAuthenticatedUser(bearer("tok-user1", { "X-Department-Id": "2" }));
    expect(first).toStrictEqual({ username: "user1", name: "User One", role: "User", vendor: "" });
    expect(selectCount()).toBe(3); // 1 readiness probe + the 2 legacy queries

    sessionAs("user1", {}, "User", 1);
    h.texts = [];
    const second = await getAuthenticatedUser(req());
    expect(second).toStrictEqual({ username: "user1", name: "user1", role: "User", vendor: "" });
    expect(selectCount()).toBe(2); // probe result cached: exactly the legacy queries

    const notReady = warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes("schema not ready"));
    expect(notReady).toHaveLength(1);
  });
});

describe("flag ON and migrations v30-v34 applied", () => {
  beforeEach(() => {
    selectDb(migrated);
    process.env.DEPARTMENTS_ENABLED = "true";
  });

  it("resolves the user with ONE query per request once readiness is cached", async () => {
    await getAuthenticatedUser(bearer("tok-user1")); // probe + resolve
    h.texts = [];
    sessionAs("user1", {}, "User", 1);
    const user = await getAuthenticatedUser(req());
    expect(selectCount()).toBe(1);
    expect(user).toMatchObject({ username: "user1", role: "User", departmentId: 1, departmentCode: "CC", scope: 1, globalRole: "User" });
  });

  it("isolation: each resolved scope sees only its own department's rows", async () => {
    const a = await getAuthenticatedUser(bearer("tok-solo1"));
    const b = await getAuthenticatedUser(bearer(`raw-solo2`)); // stored hashed
    expect(a?.scope).toBe(1);
    expect(b?.scope).toBe(2);
    for (const user of [a, b]) {
      const rows = await migrated`SELECT item_id, department_id FROM master_data WHERE department_id = ${user!.scope as number}`;
      expectOnlyDepartment(rows, user!.scope as number);
      const logs = await migrated`SELECT id, department_id FROM logs WHERE department_id = ${user!.scope as number}`;
      expectOnlyDepartment(logs, user!.scope as number);
    }
  });

  it("per-department role: same person, different role in each department (bearer header)", async () => {
    const inA = await getAuthenticatedUser(bearer("tok-user1"));
    const inB = await getAuthenticatedUser(bearer("tok-user1", { "X-Department-Id": "2" }));
    expect(inA).toMatchObject({ role: "User", departmentId: 1, departmentCode: "CC", scope: 1 });
    expect(inB).toMatchObject({ role: "Operator", departmentId: 2, departmentCode: "MB", scope: 2, globalRole: "User" });
    expect(inB?.departmentDenied).toBeUndefined();
  });

  it("per-department role also applies to the department stored in the session token", async () => {
    sessionAs("user1", { activeDepartmentId: 2 }, "User", 1);
    await expect(getAuthenticatedUser(req())).resolves.toMatchObject({ role: "Operator", departmentId: 2, scope: 2 });
  });

  it("role comes from the database, not from the token", async () => {
    sessionAs("user1", {}, "Admin", 1); // forged/stale JWT role
    const user = await getAuthenticatedUser(req());
    expect(user?.role).toBe("User");
  });

  it("a session department the user is not in silently falls back to the default department", async () => {
    sessionAs("solo1", { activeDepartmentId: 2 }, "User", 1);
    const user = await getAuthenticatedUser(req());
    expect(user).toMatchObject({ departmentId: 1, scope: 1 });
    expect(user?.departmentDenied).toBeUndefined();
  });

  it("Admin: role Admin everywhere, ALL scope allowed, default department otherwise", async () => {
    await expect(getAuthenticatedUser(bearer("tok-admin1"))).resolves.toMatchObject({ role: "Admin", departmentId: 1, scope: 1 });
    await expect(getAuthenticatedUser(bearer("tok-admin1", { "X-Department-Id": "2" }))).resolves.toMatchObject({ role: "Admin", departmentId: 2, departmentCode: "MB", scope: 2 });
    const all = await getAuthenticatedUser(bearer("tok-admin1", { "X-Department-Id": "ALL" }));
    expect(all).toMatchObject({ role: "Admin", departmentId: null, departmentCode: null, scope: "ALL" });
    sessionAs("admin1", { activeDepartmentId: "ALL" }, "Admin", 1);
    await expect(getAuthenticatedUser(req())).resolves.toMatchObject({ scope: "ALL" });
  });

  it("non-Admin can never get ALL: header => denied, token => default department", async () => {
    const viaHeader = await getAuthenticatedUser(bearer("tok-user1", { "X-Department-Id": "ALL" }));
    expect(viaHeader).toMatchObject({ departmentDenied: true, scope: 1 });
    sessionAs("user1", { activeDepartmentId: "ALL" }, "User", 1);
    const viaToken = await getAuthenticatedUser(req());
    expect(viaToken).toMatchObject({ scope: 1 });
    expect(viaToken?.departmentDenied).toBeUndefined();
  });

  const NO_MEMBERSHIP_WARNING = "[departments] user rejected: no department assignment (no user_departments row)";

  it("user without any membership => REJECTED (no fallback to CC) + a warning, on every auth path", async () => {
    await expect(getAuthenticatedUser(bearer("tok-newbie"))).resolves.toBeNull();
    await expect(getAuthenticatedUser(bearer("tok-newbie", { "X-Department-Id": "1" }))).resolves.toBeNull();
    sessionAs("newbie", {}, "User", 1);
    await expect(getAuthenticatedUser(req())).resolves.toBeNull();
    await expect(isCurrentAuthSession("newbie", 1)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(NO_MEMBERSHIP_WARNING, "newbie");
  });

  it("revoking every membership really revokes access; restoring it restores access", async () => {
    await expect(getAuthenticatedUser(bearer("tok-solo1"))).resolves.toMatchObject({ scope: 1 });
    await migrated.db.exec(`DELETE FROM user_departments WHERE username = 'solo1'`);
    try {
      await expect(getAuthenticatedUser(bearer("tok-solo1"))).resolves.toBeNull();
      sessionAs("solo1", {}, "User", 1);
      await expect(getAuthenticatedUser(req())).resolves.toBeNull();
    } finally {
      await migrated.db.exec(`INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('solo1', 1, NULL, true)`);
    }
    await expect(getAuthenticatedUser(bearer("tok-solo1"))).resolves.toMatchObject({ scope: 1 });
  });

  it("a global Admin WITHOUT any membership row can still enter any active department (to repair memberships)", async () => {
    await migrated.db.exec(`INSERT INTO users (username, password_hash, name, role, token) VALUES ('rootadmin', 'x', 'Root Admin', 'Admin', 'tok-rootadmin')`);
    try {
      await expect(getAuthenticatedUser(bearer("tok-rootadmin"))).resolves.toMatchObject({ role: "Admin", departmentId: 1, scope: 1 });
      await expect(getAuthenticatedUser(bearer("tok-rootadmin", { "X-Department-Id": "2" }))).resolves.toMatchObject({ role: "Admin", departmentId: 2, scope: 2 });
      await expect(getAuthenticatedUser(bearer("tok-rootadmin", { "X-Department-Id": "ALL" }))).resolves.toMatchObject({ scope: "ALL" });
    } finally {
      await migrated.db.exec(`DELETE FROM users WHERE username = 'rootadmin'`);
    }
  });

  it("the rejection warning fires once per username per process, not on every request", async () => {
    for (let i = 0; i < 3; i++) await getAuthenticatedUser(bearer("tok-newbie"));
    const noMembership = () => warn.mock.calls.filter((call: unknown[]) => call[0] === NO_MEMBERSHIP_WARNING);
    expect(noMembership()).toHaveLength(1);
    await migrated.db.exec(`INSERT INTO users (username, password_hash, name, role, token) VALUES ('newbie2', 'x', 'N2', 'User', 'tok-newbie2')`);
    try {
      await getAuthenticatedUser(bearer("tok-newbie2"));
      await getAuthenticatedUser(bearer("tok-newbie2"));
      expect(noMembership()).toHaveLength(2);
    } finally {
      await migrated.db.exec(`DELETE FROM users WHERE username = 'newbie2'`);
    }
  });

  describe("effective role: users.role is the source of truth, user_departments.role is only an override", () => {
    it("the v30 backfill leaves the membership role NULL, so a later change of users.role applies", async () => {
      expect((await migrated.db.query("SELECT role FROM user_departments WHERE username = 'solo1'")).rows).toEqual([{ role: null }]);
      await migrated.db.exec(`UPDATE users SET role = 'Operator' WHERE username = 'solo1'`);
      try {
        await expect(getAuthenticatedUser(bearer("tok-solo1"))).resolves.toMatchObject({ role: "Operator", globalRole: "Operator" });
      } finally {
        await migrated.db.exec(`UPDATE users SET role = 'User' WHERE username = 'solo1'`);
      }
      await expect(getAuthenticatedUser(bearer("tok-solo1"))).resolves.toMatchObject({ role: "User" });
    });

    it("a demoted Admin is not Admin, even when the membership row says 'Admin'", async () => {
      await migrated.db.exec(`
        INSERT INTO users (username, password_hash, name, role, token) VALUES ('exadmin', 'x', 'Ex Admin', 'User', 'tok-exadmin');
        INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('exadmin', 1, 'Admin', true);
      `);
      try {
        const user = await getAuthenticatedUser(bearer("tok-exadmin"));
        expect(user).toMatchObject({ role: "User", globalRole: "User", departmentId: 1 });
        await expect(getAuthenticatedUser(bearer("tok-exadmin", { "X-Department-Id": "ALL" }))).resolves.toMatchObject({ role: "User", departmentDenied: true });
      } finally {
        await migrated.db.exec(`DELETE FROM users WHERE username = 'exadmin'`);
      }
      // The real admin demoted in users.role (membership role NULL) is a plain User afterwards.
      await migrated.db.exec(`UPDATE users SET role = 'User' WHERE username = 'admin1'`);
      try {
        await expect(getAuthenticatedUser(bearer("tok-admin1"))).resolves.toMatchObject({ role: "User", globalRole: "User" });
      } finally {
        await migrated.db.exec(`UPDATE users SET role = 'Admin' WHERE username = 'admin1'`);
      }
    });

    it("a user changed to Vendor with a staff membership role is a Vendor", async () => {
      await migrated.db.exec(`UPDATE users SET role = 'Vendor' WHERE username = 'user1'`);
      try {
        for (const header of [undefined, "2"]) {
          const user = await getAuthenticatedUser(bearer("tok-user1", header ? { "X-Department-Id": header } : {}));
          expect(user, String(header)).toMatchObject({ role: "Vendor", globalRole: "Vendor", departmentId: 1 });
        }
      } finally {
        await migrated.db.exec(`UPDATE users SET role = 'User' WHERE username = 'user1'`);
      }
    });

    it("a Vendor with a non-Vendor membership role stays Vendor", async () => {
      await migrated.db.exec(`UPDATE user_departments SET role = 'Operator' WHERE username = 'vendor1'`);
      try {
        await expect(getAuthenticatedUser(bearer("tok-vendor1"))).resolves.toMatchObject({ role: "Vendor", departmentId: 1 });
      } finally {
        await migrated.db.exec(`UPDATE user_departments SET role = NULL WHERE username = 'vendor1'`);
      }
    });

    it("effectiveRole unit rules, including NULL staying NULL", () => {
      expect(effectiveRole("Admin", "User")).toBe("Admin");
      expect(effectiveRole("Vendor", "Admin")).toBe("Vendor");
      expect(effectiveRole("User", "Admin")).toBe("User");
      expect(effectiveRole("User", "Operator")).toBe("Operator");
      expect(effectiveRole("User", null)).toBe("User");
      expect(effectiveRole(null, null)).toBeNull();
    });
  });

  describe("the ready path never returns a null scope: unresolvable users are rejected", () => {
    const setActive = (ids: number[], active: boolean) => migrated.db.exec(`UPDATE departments SET is_active = ${active} WHERE id IN (${ids.join(",")})`);

    it("membership only in an inactive department => rejected (deactivation works), others unaffected", async () => {
      await setActive([2], false);
      try {
        await expect(getAuthenticatedUser(bearer("raw-solo2"))).resolves.toBeNull();
        sessionAs("solo2", {}, "User", 1);
        await expect(getAuthenticatedUser(req())).resolves.toBeNull();
        await expect(isCurrentAuthSession("solo2", 1)).resolves.toBe(false);
        h.auth.mockResolvedValue(null);
        // user1 is also in dept 1, so it falls to the active one.
        await expect(getAuthenticatedUser(bearer("tok-user1", { "X-Department-Id": "2" }))).resolves.toMatchObject({ departmentId: 1, departmentDenied: true });
      } finally {
        await setActive([2], true);
      }
      await expect(getAuthenticatedUser(bearer("raw-solo2"))).resolves.toMatchObject({ scope: 2 });
    });

    it("membership only in an inactive CC => rejected; no membership stays rejected either way", async () => {
      await setActive([1], false);
      try {
        await expect(getAuthenticatedUser(bearer("tok-newbie"))).resolves.toBeNull();
        await expect(getAuthenticatedUser(bearer("tok-solo1"))).resolves.toBeNull(); // membership only in the inactive CC
      } finally {
        await setActive([1], true);
      }
      await expect(getAuthenticatedUser(bearer("tok-solo1"))).resolves.toMatchObject({ scope: 1 });
      await expect(getAuthenticatedUser(bearer("tok-newbie"))).resolves.toBeNull();
    });

    it("Admin with no active department => rejected, also for ALL", async () => {
      await setActive([1, 2], false);
      try {
        await expect(getAuthenticatedUser(bearer("tok-admin1"))).resolves.toBeNull();
        await expect(getAuthenticatedUser(bearer("tok-admin1", { "X-Department-Id": "ALL" }))).resolves.toBeNull();
      } finally {
        await setActive([1, 2], true);
      }
      await expect(getAuthenticatedUser(bearer("tok-admin1"))).resolves.toMatchObject({ role: "Admin", scope: 1 });
    });
  });

  it("Vendor is locked to their single department and cannot ask for another one or for ALL", async () => {
    for (const header of ["2", "ALL", "999"]) {
      const user = await getAuthenticatedUser(bearer("tok-vendor1", { "X-Department-Id": header }));
      expect(user).toMatchObject({ role: "Vendor", departmentId: 1, scope: 1 });
      expect(user?.departmentDenied).toBeUndefined();
    }
    // Even a vendor with a second membership row stays on the default department.
    await migrated.db.exec(`INSERT INTO user_departments (username, department_id, role) VALUES ('vendor1', 2, 'Vendor')`);
    try {
      const user = await getAuthenticatedUser(bearer("tok-vendor1", { "X-Department-Id": "2" }));
      expect(user).toMatchObject({ departmentId: 1, scope: 1 });
    } finally {
      await migrated.db.exec(`DELETE FROM user_departments WHERE username = 'vendor1' AND department_id = 2`);
    }
  });

  it("Bearer header: valid => that department, absent => default, invalid / not a member => denied", async () => {
    await expect(getAuthenticatedUser(bearer("tok-user1", { "X-Department-Id": "2" }))).resolves.toMatchObject({ departmentId: 2 });
    const absent = await getAuthenticatedUser(bearer("tok-user1"));
    expect(absent).toMatchObject({ departmentId: 1 });
    expect(absent?.departmentDenied).toBeUndefined();

    for (const bad of ["abc", "1.5", "-1", "1234567890", "all", " ", "1;DROP", "0"]) {
      const user = await getAuthenticatedUser(bearer("tok-user1", { "X-Department-Id": bad }));
      expect(user, bad).toMatchObject({ username: "user1", departmentDenied: true });
    }
    await expect(getAuthenticatedUser(bearer("tok-solo1", { "X-Department-Id": "2" }))).resolves.toMatchObject({ departmentId: 1, departmentDenied: true });
    await expect(getAuthenticatedUser(bearer("tok-user1", { "X-Department-Id": "77" }))).resolves.toMatchObject({ departmentDenied: true });
  });

  it("the session path ignores X-Department-Id", async () => {
    sessionAs("user1", {}, "User", 1);
    const user = await getAuthenticatedUser(req({ "X-Department-Id": "2" }));
    expect(user).toMatchObject({ departmentId: 1, role: "User" });
    expect(user?.departmentDenied).toBeUndefined();
    const bogus = await getAuthenticatedUser(req({ "X-Department-Id": "not-a-number" }));
    expect(bogus?.departmentDenied).toBeUndefined();
  });

  it("still rejects stale sessions, suspended accounts, unknown and expired tokens", async () => {
    sessionAs("user1", {}, "User", 99);
    await expect(getAuthenticatedUser(req())).resolves.toBeNull();
    h.auth.mockResolvedValue(null);
    await expect(getAuthenticatedUser(bearer("tok-nobody"))).resolves.toBeNull();

    await migrated.db.exec(`UPDATE users SET account_status = 'suspended' WHERE username = 'solo1'`);
    await migrated.db.exec(`UPDATE users SET token_expiry = '2000-01-01' WHERE username = 'solo2'`);
    try {
      await expect(getAuthenticatedUser(bearer("tok-solo1"))).resolves.toBeNull();
      await expect(getAuthenticatedUser(bearer("raw-solo2"))).resolves.toBeNull();
      await expect(isCurrentAuthSession("solo1", 1)).resolves.toBe(false);
    } finally {
      await migrated.db.exec(`UPDATE users SET account_status = 'active' WHERE username = 'solo1'; UPDATE users SET token_expiry = NULL WHERE username = 'solo2'`);
    }
    await expect(isCurrentAuthSession("user1", 1)).resolves.toBe(true);
    await expect(isCurrentAuthSession("user1", undefined)).resolves.toBe(false);
  });

  it("42703 in the middle of a request => legacy path for that request and the next minute, schema marked not ready", async () => {
    await getAuthenticatedUser(bearer("tok-user1")); // readiness cached as true
    h.texts = [];
    h.failWhen = (text) => /user_departments/.test(text) && !/information_schema/.test(text);

    const first = await getAuthenticatedUser(bearer("tok-user1"));
    expect(first).toStrictEqual({ username: "user1", name: "User One", role: "User", vendor: "" });
    const failed = h.texts.filter((text) => /user_departments/.test(text));
    expect(failed).toHaveLength(1); // retried once, on the legacy path
    expect(selectCount()).toBe(3); // the failed department query + 2 legacy queries
    expect(warn.mock.calls.some((call: unknown[]) => String(call[0]).includes("schema not ready"))).toBe(true);

    h.texts = [];
    await getAuthenticatedUser(bearer("tok-user1"));
    expect(h.texts.filter((text) => /user_departments/.test(text))).toHaveLength(0);
    expect(selectCount()).toBe(2);
  });

  it("a non-schema database error is not retried: bearer => null (same as before)", async () => {
    await getAuthenticatedUser(bearer("tok-user1"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    h.failCode = "08006";
    h.failWhen = (text) => /user_departments/.test(text) && /^\s*SELECT/i.test(text);
    await expect(getAuthenticatedUser(bearer("tok-user1"))).resolves.toBeNull();
    error.mockRestore();
  });
});
