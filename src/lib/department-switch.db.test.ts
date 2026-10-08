import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Department switch validation + the real Auth.js jwt callback from src/auth.ts, on PGlite with the production schema + v30-v34.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
type Callback = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  texts: [] as string[],
  config: null as null | { callbacks: Record<string, unknown> },
}));

vi.mock("@/lib/db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.texts.push(strings.join("?"));
    return (h.target as Impl)(strings, ...values);
  },
}));
vi.mock("next-auth", () => ({
  default: (config: typeof h.config) => {
    h.config = config;
    return { handlers: {}, auth: vi.fn(), unstable_update: vi.fn() };
  },
}));
vi.mock("next-auth/providers/google", () => ({ default: () => ({ id: "google" }) }));
vi.mock("next-auth/providers/credentials", () => ({ default: () => ({ id: "credentials" }) }));
vi.mock("@/lib/auth-service", () => ({ findActiveUserByEmail: vi.fn(), validateCredentials: vi.fn() }));

import { applyActiveDepartmentUpdate, parseRequestedDepartment, validateDepartmentSwitch } from "./department-switch";
import { resetDepartmentsFlagForTests } from "./departments-flag";

let migrated: PgliteSql;
let warn: ReturnType<typeof vi.spyOn>;

const jwt = () => h.config!.callbacks.jwt as Callback;
const tokenFor = (username: string) => ({ username, role: "User", vendor: "", sessionVersion: 1 });

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
  await migrated.db.exec(`
    INSERT INTO departments (id, name, code, is_active) VALUES (3, 'Closed lab', 'XX', false);
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('user1', 3, 'User', false);
  `);
  h.target = migrated as unknown as Impl;
  await import("@/auth"); // runs NextAuth(config) against the mock above and captures the real callbacks
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
});

beforeEach(() => {
  h.texts = [];
  resetDepartmentsFlagForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  process.env.DEPARTMENTS_ENABLED = "true";
});

afterEach(() => {
  delete process.env.DEPARTMENTS_ENABLED;
  warn.mockRestore();
});

describe("parseRequestedDepartment", () => {
  it("accepts positive ints and ALL only", () => {
    expect(parseRequestedDepartment(2)).toBe(2);
    expect(parseRequestedDepartment("ALL")).toBe("ALL");
    for (const bad of ["2", 0, -1, 1.5, 2_147_483_648, null, undefined, {}, [], "all", true]) {
      expect(parseRequestedDepartment(bad)).toBeNull();
    }
  });
});

describe("validateDepartmentSwitch", () => {
  it("member can switch to a department they belong to, with the per-department role", async () => {
    const result = await validateDepartmentSwitch("user1", DEPT_B);
    expect(result).toEqual({
      activeDepartmentId: DEPT_B,
      department: { id: DEPT_B, name: "งานอณูชีววิทยา", code: "MB", role: "Operator" },
      scope: DEPT_B,
    });
  });

  it("rejects a department the user is not in (forged id) and ids that do not exist", async () => {
    expect(await validateDepartmentSwitch("solo1", DEPT_B)).toBeNull();
    expect(await validateDepartmentSwitch("solo2", DEPT_A)).toBeNull();
    expect(await validateDepartmentSwitch("user1", 999)).toBeNull();
  });

  it("a stale or forged member role of Admin never makes a non-Admin an Admin (same rule as department-context)", async () => {
    await migrated.db.exec(`UPDATE user_departments SET role = 'Admin' WHERE username = 'solo1' AND department_id = ${DEPT_A}`);
    try {
      const result = await validateDepartmentSwitch("solo1", DEPT_A);
      expect(result).not.toBeNull();
      expect(result?.department.role).not.toBe("Admin");
    } finally {
      await migrated.db.exec(`UPDATE user_departments SET role = NULL WHERE username = 'solo1' AND department_id = ${DEPT_A}`);
    }
  });

  it("rejects a membership in an inactive department", async () => {
    expect(await validateDepartmentSwitch("user1", 3)).toBeNull();
  });

  it("rejects ALL for non-Admin and accepts it for a global Admin", async () => {
    expect(await validateDepartmentSwitch("user1", "ALL")).toBeNull();
    expect(await validateDepartmentSwitch("solo1", "ALL")).toBeNull();
    expect(await validateDepartmentSwitch("admin1", "ALL")).toMatchObject({ activeDepartmentId: "ALL", scope: "ALL", department: { id: null, role: "Admin" } });
  });

  it("global Admin may enter any active department with role Admin, but not an inactive one", async () => {
    expect(await validateDepartmentSwitch("admin1", DEPT_B)).toMatchObject({ activeDepartmentId: DEPT_B, department: { role: "Admin" } });
    expect(await validateDepartmentSwitch("admin1", 3)).toBeNull();
  });

  it("Vendor cannot switch, not even to its own department or ALL", async () => {
    expect(await validateDepartmentSwitch("vendor1", DEPT_A)).toBeNull();
    expect(await validateDepartmentSwitch("vendor1", DEPT_B)).toBeNull();
    expect(await validateDepartmentSwitch("vendor1", "ALL")).toBeNull();
  });

  it("rejects unknown users, inactive accounts and bad usernames", async () => {
    expect(await validateDepartmentSwitch("ghost", DEPT_A)).toBeNull();
    expect(await validateDepartmentSwitch(undefined, DEPT_A)).toBeNull();
    expect(await validateDepartmentSwitch("", DEPT_A)).toBeNull();
    await migrated.db.exec(`UPDATE users SET account_status = 'suspended' WHERE username = 'solo1'`);
    try {
      expect(await validateDepartmentSwitch("solo1", DEPT_A)).toBeNull();
    } finally {
      await migrated.db.exec(`UPDATE users SET account_status = 'active' WHERE username = 'solo1'`);
    }
  });
});

describe("jwt callback (src/auth.ts) with trigger update", () => {
  it("valid switch sets activeDepartmentId and keeps the rest of the token", async () => {
    const token = await jwt()({ token: tokenFor("user1"), trigger: "update", session: { activeDepartmentId: DEPT_B } });
    expect(token).toEqual({ ...tokenFor("user1"), activeDepartmentId: DEPT_B });
  });

  it("Admin can switch to ALL", async () => {
    const token = await jwt()({ token: tokenFor("admin1"), trigger: "update", session: { activeDepartmentId: "ALL" } });
    expect(token.activeDepartmentId).toBe("ALL");
  });

  it("forged id, ALL for non-Admin, Vendor, bad types: token unchanged", async () => {
    const cases: Array<[string, unknown]> = [
      ["solo1", DEPT_B],
      ["user1", "ALL"],
      ["vendor1", DEPT_A],
      ["user1", "2"],
      ["user1", { $ne: 1 }],
      ["user1", undefined],
    ];
    for (const [username, requested] of cases) {
      const before = tokenFor(username);
      const token = await jwt()({ token: { ...before }, trigger: "update", session: { activeDepartmentId: requested } });
      expect(token).toEqual(before);
    }
    for (const session of [null, undefined, "x", 5, []]) {
      expect(await jwt()({ token: tokenFor("user1"), trigger: "update", session })).toEqual(tokenFor("user1"));
    }
  });

  it("ignores every other field the client sends (role, username, sessionVersion, vendor...)", async () => {
    const token = await jwt()({
      token: tokenFor("solo1"),
      trigger: "update",
      session: { activeDepartmentId: DEPT_A, role: "Admin", username: "admin1", sessionVersion: 99, vendor: "Evil", user: { role: "Admin" } },
    });
    expect(token).toEqual({ ...tokenFor("solo1"), activeDepartmentId: DEPT_A });
  });

  it("the token's own username decides, never one sent by the client", async () => {
    const token = await jwt()({ token: tokenFor("solo1"), trigger: "update", session: { activeDepartmentId: DEPT_B, username: "user1" } });
    expect(token).toEqual(tokenFor("solo1"));
  });

  it("flag off: token returned unchanged with ZERO sql calls", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    const before = tokenFor("user1");
    const token = await jwt()({ token: { ...before }, trigger: "update", session: { activeDepartmentId: DEPT_B } });
    expect(token).toEqual(before);
    expect(h.texts).toEqual([]);
  });

  it("flag on but schema not ready: token unchanged and no switch query is run", async () => {
    const legacy = createPgliteSql(new PGlite());
    await legacy.db.exec(`CREATE TABLE users (username text, role text)`);
    h.target = legacy as unknown as Impl;
    try {
      const before = tokenFor("user1");
      const token = await jwt()({ token: { ...before }, trigger: "update", session: { activeDepartmentId: DEPT_B } });
      expect(token).toEqual(before);
      expect(h.texts.some((text) => text.includes("JOIN user_departments"))).toBe(false);
    } finally {
      h.target = migrated as unknown as Impl;
      await legacy.db.close();
    }
  });

  it("a database error leaves the token unchanged instead of throwing (no lock-out)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = h.target as Impl;
    let calls = 0;
    h.target = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls += 1;
      // first call = readiness probe (real), second = the switch query (fails)
      return calls === 1 ? saved(strings, ...values) : Promise.reject(new Error("boom"));
    }) as Impl;
    try {
      const before = tokenFor("user1");
      expect(await applyActiveDepartmentUpdate({ ...before }, { activeDepartmentId: DEPT_B })).toEqual(before);
    } finally {
      h.target = saved;
      error.mockRestore();
    }
  });

  it("sign-in path (no trigger, no user) is unchanged: token returned as is, no sql", async () => {
    const before = tokenFor("user1");
    expect(await jwt()({ token: { ...before } })).toEqual(before);
    expect(h.texts).toEqual([]);
  });

  it("the session callback exposes activeDepartmentId next to the other fields", async () => {
    const callback = h.config!.callbacks.session as Callback;
    const session = await callback({ session: { user: {} }, token: { ...tokenFor("user1"), activeDepartmentId: DEPT_B } });
    expect((session.user as Record<string, unknown>).activeDepartmentId).toBe(DEPT_B);
  });
});
