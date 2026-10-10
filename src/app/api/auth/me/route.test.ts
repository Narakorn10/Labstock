import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  texts: [] as string[],
  auth: vi.fn(),
  userOverride: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.texts.push(strings.join("?"));
    return (h.target as Impl)(strings, ...values);
  },
}));
vi.mock("@/auth", () => ({ auth: h.auth }));
// Lets some tests hand /me a user object directly (e.g. one whose fallback computation throws).
vi.mock("@/lib/auth-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-utils")>();
  return {
    ...actual,
    getAuthenticatedUser: (request: Request) => (h.userOverride ? Promise.resolve(h.userOverride) : actual.getAuthenticatedUser(request)),
  };
});

import { GET } from "./route";
import { departmentsReady, resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { parseDepartmentContext } from "@/lib/department-switcher-state";

let migrated: PgliteSql;

function sessionAs(username: string, role = "User", extra: Record<string, unknown> = {}) {
  h.auth.mockResolvedValue({ user: { username, name: username, role, vendor: "", sessionVersion: 1, ...extra } });
}

const get = (headers: Record<string, string> = {}) => GET(new Request("http://localhost/api/auth/me", { headers }));

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
  h.target = migrated as unknown as Impl;
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
});

beforeEach(() => {
  h.texts = [];
  h.auth.mockReset();
  h.auth.mockResolvedValue(null);
  h.userOverride = null;
  h.target = migrated as unknown as Impl;
  resetDepartmentsFlagForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.DEPARTMENTS_ENABLED;
});

afterEach(() => {
  delete process.env.DEPARTMENTS_ENABLED;
  vi.restoreAllMocks();
});

// Step 0 golden: with DEPARTMENTS_ENABLED unset, /api/auth/me must behave exactly as before the department switcher.
// auth-provider.tsx signs the user out whenever /me is not ok, so the body shape and the SQL order are locked here.
describe("GET /api/auth/me (flag off, golden)", () => {
  it("401 { error: 'Unauthorized' } without a session or token, and no sql at all", async () => {
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(h.texts).toEqual([]);
  });

  it("200 body is exactly { success, user: { username, name, role, vendor, department } } with no department keys", async () => {
    sessionAs("user1");
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      user: { username: "user1", name: "user1", role: "User", vendor: "", department: null },
    });
    expect(Object.keys(body)).toEqual(["success", "user"]);
    expect(Object.keys(body.user)).toEqual(["username", "name", "role", "vendor", "department"]);
  });

  it("department column value is trimmed into user.department; blank becomes null", async () => {
    sessionAs("user1");
    await migrated.db.exec(`UPDATE users SET department = '  ห้อง A  ' WHERE username = 'user1'`);
    try {
      expect((await (await get()).json()).user.department).toBe("ห้อง A");
      await migrated.db.exec(`UPDATE users SET department = '   ' WHERE username = 'user1'`);
      expect((await (await get()).json()).user.department).toBeNull();
    } finally {
      await migrated.db.exec(`UPDATE users SET department = NULL WHERE username = 'user1'`);
    }
  });

  it("sql order is exactly the legacy order and never mentions departments", async () => {
    sessionAs("user1");
    expect((await get()).status).toBe(200);
    const texts = h.texts.map(squash);
    // The information_schema probe is cached by auth-service for a while, so it only runs for the first request in a process.
    const withoutProbe = texts[0] === GOLDEN_SCHEMA_PROBE ? texts.slice(1) : texts;
    expect(withoutProbe).toEqual(GOLDEN_SQL);
    expect(h.texts.some((text) => /user_departments|FROM departments|department_id/i.test(text))).toBe(false);
  });

  it("a failing department lookup still answers 200 with department: null", async () => {
    sessionAs("user1");
    const real = migrated as unknown as Impl;
    h.target = (strings, ...values) => {
      if (strings.join("?").includes("to_jsonb(u)")) throw new Error("boom");
      return real(strings, ...values);
    };
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      user: { username: "user1", name: "user1", role: "User", vendor: "", department: null },
    });
  });

  it("flag on but schema missing (legacy database): same body as flag off, no departmentContext", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    const legacy = createPgliteSql(new PGlite());
    await legacy.db.exec(`
      CREATE TABLE users (username text, name text, role text, vendor text, session_version int, account_status text);
      INSERT INTO users VALUES ('user1', 'user1', 'User', '', 1, 'active');
    `);
    h.target = legacy as unknown as Impl;
    try {
      sessionAs("user1");
      const response = await get();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        success: true,
        user: { username: "user1", name: "user1", role: "User", vendor: "", department: null },
      });
      expect("departmentContext" in body).toBe(false);
    } finally {
      await legacy.db.close();
    }
  });
});

const CC = { id: 1, name: "ห้องปฏิบัติการเคมีคลินิก", code: "CC" };
const MB = { id: 2, name: "งานอณูชีววิทยา", code: "MB" };
const LIST_QUERY = "JOIN departments d ON d.is_active";

describe("GET /api/auth/me (flag on, departmentContext)", () => {
  beforeEach(() => {
    process.env.DEPARTMENTS_ENABLED = "true";
  });

  async function ctxOf(response: Response) {
    expect(response.status).toBe(200);
    const body = await response.json();
    return { body, ctx: body.departmentContext as Record<string, unknown> | undefined };
  }

  function failList(make: () => unknown) {
    const real = migrated as unknown as Impl;
    h.target = (strings, ...values) => {
      if (strings.join("?").includes(LIST_QUERY)) return make();
      return real(strings, ...values);
    };
  }

  it("user1 (member of CC + MB): active CC, options [CC, MB]; the user keys are unchanged", async () => {
    sessionAs("user1");
    const { body, ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: 1, active: { ...CC }, options: [CC, MB], canViewAll: false, readOnly: false });
    expect(Object.keys(body)).toEqual(["success", "user", "departmentContext"]);
    expect(body.user).toMatchObject({ username: "user1", role: "User", department: null, departmentId: 1, scope: 1 });
  });

  it("user1 with JWT activeDepartmentId = MB: active MB", async () => {
    sessionAs("user1", "User", { activeDepartmentId: 2 });
    const { body, ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: 2, active: { ...MB }, options: [CC, MB], canViewAll: false, readOnly: false });
    expect(body.user.role).toBe("Operator");
  });

  it("JWT activeDepartmentId the user is not a member of falls back to the default department", async () => {
    sessionAs("solo1", "User", { activeDepartmentId: 2 });
    const { ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: 1, active: { ...CC }, options: [CC], canViewAll: false, readOnly: false });
  });

  it("solo1: a single option (the UI hides the switcher)", async () => {
    sessionAs("solo1");
    const { ctx } = await ctxOf(await get());
    expect(ctx).toMatchObject({ scope: 1, active: { ...CC }, options: [CC] });
  });

  it("vendor1: options [] and active is the vendor's own department (name falls back to the code: no extra lookup)", async () => {
    sessionAs("vendor1", "Vendor");
    const { ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: 1, active: { id: 1, name: "CC", code: "CC" }, options: [], canViewAll: false, readOnly: false });
  });

  it("newbie (no membership): 401 like before, no context", async () => {
    sessionAs("newbie");
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("admin1 in a department: options are every active department with a code, canViewAll true", async () => {
    sessionAs("admin1", "Admin");
    const { ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: 1, active: { ...CC }, options: [CC, MB], canViewAll: true, readOnly: false });
  });

  it("admin1 with JWT 'ALL': scope ALL, active null, readOnly true, options is the switchable list (not null, not a fallback)", async () => {
    sessionAs("admin1", "Admin", { activeDepartmentId: "ALL" });
    const { ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: "ALL", active: null, options: [CC, MB], canViewAll: true, readOnly: true });
    expect(ctx?.options).not.toBeNull();
  });

  it("a department without a code: active shows its real name with code null, and it is not an option", async () => {
    await migrated.db.exec(`
      INSERT INTO departments (id, name, code, is_active) VALUES (4, 'งานที่ยังไม่มีรหัส', NULL, true);
      INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('solo1', 4, NULL, false);
    `);
    try {
      sessionAs("solo1", "User", { activeDepartmentId: 4 });
      const { ctx } = await ctxOf(await get());
      expect(ctx).toEqual({ scope: 4, active: { id: 4, name: "งานที่ยังไม่มีรหัส", code: null }, options: [CC], canViewAll: false, readOnly: false });
    } finally {
      await migrated.db.exec(`DELETE FROM user_departments WHERE department_id = 4; DELETE FROM departments WHERE id = 4;`);
    }
  });

  it("closed departments are never options", async () => {
    await migrated.db.exec(`
      INSERT INTO departments (id, name, code, is_active) VALUES (3, 'งานที่ปิดแล้ว', 'X3', false);
      INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('user1', 3, NULL, false);
    `);
    try {
      sessionAs("user1");
      const { ctx } = await ctxOf(await get());
      expect(ctx?.options).toEqual([CC, MB]);
    } finally {
      await migrated.db.exec(`DELETE FROM user_departments WHERE department_id = 3; DELETE FROM departments WHERE id = 3;`);
    }
  });

  it("a Bearer client also receives the context (switching still needs the cookie route)", async () => {
    await migrated.db.exec(`UPDATE users SET token = 'tok-' || username WHERE username = 'user1'`);
    try {
      const { ctx } = await ctxOf(await get({ Authorization: "Bearer tok-user1" }));
      expect(ctx).toMatchObject({ scope: 1, active: { ...CC }, options: [CC, MB] });
    } finally {
      await migrated.db.exec(`UPDATE users SET token = NULL WHERE username = 'user1'`);
    }
  });

  it("the real body is accepted by the client parser parseDepartmentContext", async () => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["user1", "User", {}],
      ["solo1", "User", {}],
      ["vendor1", "Vendor", {}],
      ["admin1", "Admin", { activeDepartmentId: "ALL" }],
    ];
    for (const [username, role, extra] of cases) {
      sessionAs(username, role, extra);
      const { body } = await ctxOf(await get());
      const parsed = parseDepartmentContext(body.departmentContext);
      expect(parsed, username).not.toBeNull();
      expect(parsed, username).toEqual(body.departmentContext);
    }
  });

  it("list fails with 42P01 (schema vanished): 200, fallback context (options null), departments marked not ready", async () => {
    sessionAs("user1");
    failList(() => {
      throw Object.assign(new Error("undefined table"), { code: "42P01" });
    });
    const { body, ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: 1, active: { id: 1, name: "CC", code: "CC" }, options: null, canViewAll: false, readOnly: false });
    expect(body.user).toMatchObject({ username: "user1", department: null });
    h.target = migrated as unknown as Impl;
    expect(await departmentsReady()).toBe(false);
  });

  it("list fails with a TypeError (no code): 200, options null, the flag stays ready", async () => {
    sessionAs("admin1", "Admin");
    failList(() => {
      throw new TypeError("x is not iterable");
    });
    const { ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: 1, active: { id: 1, name: "CC", code: "CC" }, options: null, canViewAll: true, readOnly: false });
    h.target = migrated as unknown as Impl;
    expect(await departmentsReady()).toBe(true);
  });

  it("list fails in the ALL view: fallback keeps active null and readOnly true, options null", async () => {
    sessionAs("admin1", "Admin", { activeDepartmentId: "ALL" });
    failList(() => Promise.reject(new Error("boom")));
    const { ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: "ALL", active: null, options: null, canViewAll: true, readOnly: true });
  });

  it("the current department is missing from the list: fallback (options null), not an error", async () => {
    sessionAs("user1");
    failList(() => Promise.resolve([{ id: 2, name: MB.name, code: "MB", switchable: true }]));
    const { ctx } = await ctxOf(await get());
    expect(ctx).toEqual({ scope: 1, active: { id: 1, name: "CC", code: "CC" }, options: null, canViewAll: false, readOnly: false });
  });

  it("fallback throws too: still 200, user intact, no departmentContext key (never a 500)", async () => {
    let listFailed = false;
    const user: Record<string, unknown> = { username: "user1", name: "user1", role: "User", vendor: "", globalRole: "User", departmentId: 1, scope: 1 };
    // Non-enumerable so the response spread does not read it; only the fallback does, and only after the list failed.
    Object.defineProperty(user, "departmentCode", {
      enumerable: false,
      get() {
        if (listFailed) throw new Error("fallback boom");
        return "CC";
      },
    });
    h.userOverride = user;
    failList(() => {
      listFailed = true;
      throw new TypeError("list boom");
    });
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.user).toMatchObject({ username: "user1", department: null });
    expect("departmentContext" in body).toBe(false);
  });

  it("a user without a numeric / ALL scope (legacy shape) gets no context and no department query", async () => {
    h.userOverride = { username: "user1", name: "user1", role: "User", vendor: "" };
    const response = await get();
    expect(response.status).toBe(200);
    expect("departmentContext" in (await response.json())).toBe(false);
    expect(h.texts.some((text) => text.includes(LIST_QUERY))).toBe(false);
  });
});

const squash =(text: string) => text.replace(/\s+/g, " ").trim();

const GOLDEN_SCHEMA_PROBE = squash(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'users'
    AND column_name IN ('email', 'account_status', 'session_version')
`);

const GOLDEN_SQL: string[] = [
  "SELECT username FROM users WHERE username = ? AND account_status = 'active' AND session_version = ? LIMIT 1",
  "SELECT NULLIF(TRIM(to_jsonb(u) ->> 'department'), '') AS department FROM users u WHERE u.username = ? LIMIT 1",
];
