import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Gap-filling tests for /api/auth/me (step 6). Not repeating route.test.ts.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  texts: [] as string[],
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.texts.push(strings.join("?"));
    return (h.target as Impl)(strings, ...values);
  },
}));
vi.mock("@/auth", () => ({ auth: h.auth }));

import { GET } from "./route";
import { departmentsReady, resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { validateDepartmentSwitch } from "@/lib/department-switch";

let migrated: PgliteSql;

function sessionAs(username: string, role = "User", extra: Record<string, unknown> = {}) {
  h.auth.mockResolvedValue({ user: { username, name: username, role, vendor: "", sessionVersion: 1, ...extra } });
}
const get = () => GET(new Request("http://localhost/api/auth/me"));
const LIST_QUERY = "JOIN departments d ON d.is_active";

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

const DEPARTMENT_SQL = /user_departments|FROM departments|JOIN departments|department_id/i;

describe("/api/auth/me golden holds for every non-'true' flag value and every role (flag off)", () => {
  it.each(["false", "0", "1", "TRUE", "True", "yes", " true", ""])(
    "DEPARTMENTS_ENABLED=%j: no departmentContext, no department SQL",
    async (value) => {
      process.env.DEPARTMENTS_ENABLED = value;
      for (const [username, role] of [["user1", "User"], ["admin1", "Admin"], ["vendor1", "Vendor"]] as const) {
        h.texts = [];
        sessionAs(username, role);
        const response = await get();
        expect(response.status, username).toBe(200);
        const body = await response.json();
        expect(Object.keys(body), username).toEqual(["success", "user"]);
        expect(Object.keys(body.user), username).toEqual(["username", "name", "role", "vendor", "department"]);
        expect(body.user.role, username).toBe(role);
        expect(h.texts.some((t) => DEPARTMENT_SQL.test(t)), username).toBe(false);
      }
    },
  );

  it("flag off: an Admin session carrying a stale activeDepartmentId 'ALL' still gets the legacy body", async () => {
    sessionAs("admin1", "Admin", { activeDepartmentId: "ALL" });
    const body = await (await get()).json();
    expect(Object.keys(body)).toEqual(["success", "user"]);
    expect(body.user).not.toHaveProperty("scope");
    expect(body.user).not.toHaveProperty("departmentId");
  });
});

describe("/api/auth/me options (flag on) vs validateDepartmentSwitch", () => {
  beforeEach(() => {
    process.env.DEPARTMENTS_ENABLED = "true";
  });

  async function withExtraDepartments(run: () => Promise<void>) {
    await migrated.db.exec(`
      INSERT INTO departments (id, name, code, is_active) VALUES (3, 'งานที่ปิดแล้ว', 'X3', false), (4, 'งานที่ยังไม่มีรหัส', NULL, true);
      INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('user1', 3, NULL, false), ('user1', 4, NULL, false);
    `);
    try {
      await run();
    } finally {
      await migrated.db.exec(`DELETE FROM user_departments WHERE department_id IN (3, 4); DELETE FROM departments WHERE id IN (3, 4);`);
    }
  }

  it("every option returned to every kind of user is accepted by validateDepartmentSwitch; closed (3) and code-NULL (4) never appear", async () => {
    await withExtraDepartments(async () => {
      const cases: Array<[string, string, Record<string, unknown>]> = [
        ["user1", "User", {}],
        ["user1", "User", { activeDepartmentId: 2 }],
        ["solo1", "User", {}],
        ["admin1", "Admin", {}],
        ["admin1", "Admin", { activeDepartmentId: "ALL" }],
        ["vendor1", "Vendor", {}],
      ];
      for (const [username, role, extra] of cases) {
        sessionAs(username, role, extra);
        const body = await (await get()).json();
        const options = body.departmentContext.options as Array<{ id: number }>;
        const label = `${username} ${JSON.stringify(extra)}`;
        expect(options, label).not.toBeNull();
        for (const option of options) {
          expect(await validateDepartmentSwitch(username, option.id), `${label} -> ${option.id}`).not.toBeNull();
        }
        const ids = options.map((o) => o.id);
        expect(ids, label).not.toContain(3);
        expect(ids, label).not.toContain(4);
      }
    });
  });

  it("an active department that is NOT an option (code NULL) is refused by validateDepartmentSwitch, yet /me still names it", async () => {
    await withExtraDepartments(async () => {
      sessionAs("user1", "User", { activeDepartmentId: 4 });
      const body = await (await get()).json();
      const ctx = body.departmentContext;
      expect(ctx.active).toEqual({ id: 4, name: "งานที่ยังไม่มีรหัส", code: null });
      expect(ctx.options.map((o: { id: number }) => o.id)).toEqual([1, 2]);
      expect(await validateDepartmentSwitch("user1", 4)).toBeNull();
    });
  });

  it("global Admin in ALL: canViewAll + readOnly true, active null, and every option is a numeric id", async () => {
    sessionAs("admin1", "Admin", { activeDepartmentId: "ALL" });
    const ctx = (await (await get()).json()).departmentContext;
    expect(ctx).toMatchObject({ scope: "ALL", active: null, canViewAll: true, readOnly: true });
    expect(ctx.options.every((o: { id: unknown }) => typeof o.id === "number")).toBe(true);
    expect(await validateDepartmentSwitch("admin1", "ALL")).not.toBeNull();
  });

  it("a non-Admin whose JWT claims 'ALL' never gets readOnly / canViewAll", async () => {
    sessionAs("user1", "User", { activeDepartmentId: "ALL" });
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.departmentContext?.scope).not.toBe("ALL");
    expect(body.departmentContext?.canViewAll ?? false).toBe(false);
    expect(body.departmentContext?.readOnly ?? false).toBe(false);
  });
});

describe("/api/auth/me never 500s from the department block (flag on)", () => {
  beforeEach(() => {
    process.env.DEPARTMENTS_ENABLED = "true";
  });

  it("after a 42P01 the departments are marked not ready: the next request is the legacy body (no key, no list query)", async () => {
    sessionAs("user1");
    const real = migrated as unknown as Impl;
    h.target = (strings, ...values) => {
      if (strings.join("?").includes(LIST_QUERY)) throw Object.assign(new Error("undefined table"), { code: "42P01" });
      return real(strings, ...values);
    };
    expect((await get()).status).toBe(200);
    h.target = real;
    h.texts = [];
    const second = await get();
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(Object.keys(body)).toEqual(["success", "user"]);
    expect(h.texts.some((t) => t.includes(LIST_QUERY))).toBe(false);
    expect(await departmentsReady()).toBe(false);
  });

  it("a rejected (async) list with code 42703 behaves like 42P01: 200 + fallback + not ready", async () => {
    sessionAs("admin1", "Admin");
    const real = migrated as unknown as Impl;
    h.target = (strings, ...values) => {
      if (strings.join("?").includes(LIST_QUERY)) {
        return Promise.reject(Object.assign(new Error("undefined column"), { code: "42703" }));
      }
      return real(strings, ...values);
    };
    const response = await get();
    expect(response.status).toBe(200);
    const ctx = (await response.json()).departmentContext;
    expect(ctx).toMatchObject({ options: null, canViewAll: true, readOnly: false });
    h.target = real;
    expect(await departmentsReady()).toBe(false);
  });

  it("the display-only department lookup failing does not drop the context", async () => {
    sessionAs("user1");
    const real = migrated as unknown as Impl;
    h.target = (strings, ...values) => {
      if (strings.join("?").includes("to_jsonb(u)")) throw new Error("boom");
      return real(strings, ...values);
    };
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.department).toBeNull();
    expect(body.departmentContext.options).toHaveLength(2);
  });

  it("a non-Error rejection from the list (string / undefined / null) is still a 200 with options null", async () => {
    for (const rejection of ["plain string", undefined, null]) {
      sessionAs("solo1");
      const real = migrated as unknown as Impl;
      h.target = (strings, ...values) => {
        if (strings.join("?").includes(LIST_QUERY)) return Promise.reject(rejection);
        return real(strings, ...values);
      };
      const response = await get();
      expect(response.status, String(rejection)).toBe(200);
      expect((await response.json()).departmentContext.options, String(rejection)).toBeNull();
    }
  });
});
