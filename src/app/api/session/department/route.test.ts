import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  texts: [] as string[],
  auth: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.texts.push(strings.join("?"));
    return (h.target as Impl)(strings, ...values);
  },
}));
vi.mock("@/auth", () => ({ auth: h.auth, unstable_update: h.update }));
// Event persistence is not under test here.
vi.mock("@/lib/app-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app-events")>();
  return { ...actual, recordAppEvent: vi.fn() };
});

import { POST } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let migrated: PgliteSql;

function sessionAs(username: string, role = "User") {
  h.auth.mockResolvedValue({ user: { username, name: username, role, vendor: "", sessionVersion: 1 } });
}

const post = (body: unknown, headers: Record<string, string> = {}) => POST(new Request("http://localhost/api/session/department", {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
}));

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
  h.update.mockReset();
  // Mirrors next-auth's real return value: the new session payload produced by the session callback.
  h.update.mockImplementation(async (data: { activeDepartmentId?: unknown }) => ({
    user: { username: "x", activeDepartmentId: data.activeDepartmentId },
    expires: new Date(Date.now() + 1000).toISOString(),
  }));
  resetDepartmentsFlagForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.DEPARTMENTS_ENABLED = "true";
});

afterEach(() => {
  delete process.env.DEPARTMENTS_ENABLED;
  vi.restoreAllMocks();
});

describe("POST /api/session/department", () => {
  it("200: member switches; unstable_update gets ONLY activeDepartmentId; sessionVersion untouched", async () => {
    sessionAs("user1");
    const before = await migrated.db.query<{ session_version: number }>(`SELECT session_version FROM users WHERE username = 'user1'`);
    const response = await post({ departmentId: DEPT_B, role: "Admin", username: "admin1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      department: { id: DEPT_B, name: "งานอณูชีววิทยา", code: "MB", role: "Operator" },
      scope: DEPT_B,
    });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith({ activeDepartmentId: DEPT_B });
    const after = await migrated.db.query<{ session_version: number }>(`SELECT session_version FROM users WHERE username = 'user1'`);
    expect(after.rows).toEqual(before.rows);
  });

  it("200: Admin switches to ALL", async () => {
    sessionAs("admin1", "Admin");
    const response = await post({ departmentId: "ALL" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, scope: "ALL", department: { id: null, code: "ALL", role: "Admin" } });
    expect(h.update).toHaveBeenCalledWith({ activeDepartmentId: "ALL" });
  });

  it("404 DEPARTMENT_NOT_FOUND: forged id, ALL for non-Admin, unknown id, Vendor", async () => {
    const cases: Array<[string, string, unknown]> = [
      ["solo1", "User", DEPT_B],
      ["user1", "User", "ALL"],
      ["user1", "User", 999],
      ["vendor1", "Vendor", DEPT_A],
    ];
    for (const [username, role, departmentId] of cases) {
      sessionAs(username, role);
      const response = await post({ departmentId });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toMatchObject({ code: "DEPARTMENT_NOT_FOUND" });
      expect(body.hint).toBeTruthy();
      expect(body.requestId).toBeTruthy();
    }
    expect(h.update).not.toHaveBeenCalled();
  });

  it("400: Authorization Bearer request is refused before any lookup", async () => {
    sessionAs("user1");
    const response = await post({ departmentId: DEPT_B }, { Authorization: "Bearer tok-user1" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.texts.filter((text) => !text.includes("app_events"))).toEqual([]);
  });

  it("400: malformed body or departmentId", async () => {
    sessionAs("user1");
    expect((await post("{not json")).status).toBe(400);
    for (const departmentId of ["2", 0, 1.5, null, undefined, {}, "all"]) {
      const response = await post({ departmentId });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(h.update).not.toHaveBeenCalled();
  });

  it("400: Content-Type must be application/json (also accepts a charset suffix)", async () => {
    sessionAs("user1");
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      const response = await POST(new Request("http://localhost/api/session/department", {
        method: "POST",
        headers: contentType ? { "content-type": contentType } : {},
        body: JSON.stringify({ departmentId: DEPT_B }),
      }));
      expect(response.status, contentType).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(h.update).not.toHaveBeenCalled();
    expect((await post({ departmentId: DEPT_B }, { "content-type": "application/json; charset=utf-8" })).status).toBe(200);
  });

  it("403 FORBIDDEN: a cross-site Origin is refused; same-host or missing Origin is fine", async () => {
    sessionAs("user1");
    for (const origin of ["https://evil.example", "null", "http://localhost.evil.example"]) {
      const response = await post({ departmentId: DEPT_B }, { origin, host: "localhost" });
      expect(response.status, origin).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(h.update).not.toHaveBeenCalled();
    expect((await post({ departmentId: DEPT_B }, { origin: "http://localhost", host: "localhost" })).status).toBe(200);
    expect((await post({ departmentId: DEPT_B })).status).toBe(200);
  });

  it("404 DEPARTMENT_NOT_FOUND when unstable_update did not store the new department (jwt callback refused / no session)", async () => {
    sessionAs("user1");
    for (const result of [{ user: { username: "user1", activeDepartmentId: undefined } }, { user: { activeDepartmentId: DEPT_A } }, null, undefined]) {
      h.update.mockResolvedValueOnce(result);
      const response = await post({ departmentId: DEPT_B });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "DEPARTMENT_NOT_FOUND" });
    }
    expect(h.update).toHaveBeenCalledTimes(4);
  });

  it("401 AUTH_REQUIRED without a session", async () => {
    const response = await post({ departmentId: DEPT_A });
    expect(response.status).toBe(401);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("409 DEPARTMENTS_DISABLED when the flag is off (no department queries, no update)", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    sessionAs("user1");
    const response = await post({ departmentId: DEPT_B });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DEPARTMENTS_DISABLED" });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.texts.some((text) => /departments|department_id/i.test(text) && !text.includes("app_events"))).toBe(false);
  });

  it("409 DEPARTMENTS_DISABLED when the flag is on but the schema is missing", async () => {
    const legacy = createPgliteSql(new PGlite());
    await legacy.db.exec(`
      CREATE TABLE users (username text, role text, session_version int, account_status text);
      INSERT INTO users VALUES ('user1', 'User', 1, 'active');
    `);
    h.target = legacy as unknown as Impl;
    try {
      sessionAs("user1");
      const response = await post({ departmentId: DEPT_B });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "DEPARTMENTS_DISABLED" });
      expect(h.update).not.toHaveBeenCalled();
    } finally {
      h.target = migrated as unknown as Impl;
      await legacy.db.close();
    }
  });
});
