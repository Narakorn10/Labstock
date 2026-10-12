import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { expectOnlyDepartment, seedTwoDepartments, DEPT_A, DEPT_B } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// scoped-db helpers against the real production schema + v30-v34 (PGlite). `@/lib/db` is replaced by a thin
// delegate so fragments built inside scoped-db.ts are made by the same PGlite `sql` as the queries that embed them.

type Impl = ((strings: TemplateStringsArray, ...values: unknown[]) => unknown) & { unsafe: (text: string) => unknown };

const h = vi.hoisted(() => ({ target: null as null | Impl }));

vi.mock("@/lib/db", () => {
  const delegate = (strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values);
  delegate.unsafe = (text: string) => (h.target as Impl).unsafe(text);
  return { default: delegate };
});

import type { AuthenticatedUser } from "@/lib/auth-utils";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import {
  andDept,
  andDeptWrite,
  departmentErrorResponse,
  deptInsert,
  deptWhere,
  deptWhereWrite,
  DepartmentScopeError,
  getDepartmentScope,
  writeDepartmentId,
  type DepartmentScope,
} from "@/lib/scoped-db";

let sql: PgliteSql;

const ONE_A: DepartmentScope = { mode: "one", departmentId: DEPT_A };
const ONE_B: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const ALL: DepartmentScope = { mode: "all" };
const LEGACY: DepartmentScope = { mode: "legacy" };

const user = (extra: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({ username: "u", name: "u", role: "User", ...extra });

beforeAll(async () => {
  sql = createPgliteSql();
  await seedTwoDepartments(sql);
  h.target = sql as unknown as Impl;
});

afterAll(async () => {
  await sql.db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

describe("getDepartmentScope", () => {
  it("is legacy for scope null and for an old-style user while departments are off (no sql call)", async () => {
    expect(await getDepartmentScope(user({ scope: null }))).toEqual({ mode: "legacy" });
    expect(await getDepartmentScope(user())).toEqual({ mode: "legacy" });
  });

  it("maps a number to one and ALL to all", async () => {
    expect(await getDepartmentScope(user({ scope: 2, departmentId: 2 }))).toEqual({ mode: "one", departmentId: 2 });
    expect(await getDepartmentScope(user({ scope: "ALL", departmentId: null }))).toEqual({ mode: "all" });
  });

  it("answers DEPARTMENT_NOT_FOUND when the user asked for a department they are not in", async () => {
    await expect(getDepartmentScope(user({ scope: 1, departmentDenied: true }))).rejects.toMatchObject({
      name: "DepartmentScopeError",
      code: "DEPARTMENT_NOT_FOUND",
    });
  });

  it("fails closed (DEPARTMENT_SCOPE_MISSING) when departments are ready but scope is undefined", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    await expect(getDepartmentScope(user())).rejects.toMatchObject({ code: "DEPARTMENT_SCOPE_MISSING" });
  });

  it("fails closed (DEPARTMENT_SCOPE_MISSING) when departments are ready but scope is null", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    await expect(getDepartmentScope(user({ scope: null }))).rejects.toMatchObject({ code: "DEPARTMENT_SCOPE_MISSING" });
  });

  it("stays legacy for a null scope when the flag is on but the schema is not ready", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    const legacyDb = createPgliteSql();
    const previous = h.target;
    h.target = legacyDb as unknown as Impl;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      resetDepartmentsFlagForTests();
      expect(await getDepartmentScope(user({ scope: null }))).toEqual({ mode: "legacy" });
    } finally {
      warn.mockRestore();
      h.target = previous;
      await legacyDb.db.close();
    }
  });

  it("stays legacy for an undefined scope when the flag is on but the schema is not ready", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    const legacyDb = createPgliteSql();
    const previous = h.target;
    h.target = legacyDb as unknown as Impl;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      resetDepartmentsFlagForTests();
      expect(await getDepartmentScope(user())).toEqual({ mode: "legacy" });
    } finally {
      warn.mockRestore();
      h.target = previous;
      await legacyDb.db.close();
    }
  });
});

describe("fragments", () => {
  it("legacy: deptWhere is TRUE, andDept/deptInsert are empty, queries return every row", async () => {
    const where = deptWhere(LEGACY, "m");
    expect((where as unknown as { text: string }).text).toBe("TRUE");
    expect((andDept(LEGACY, "m") as unknown as { text: string }).text).toBe("");
    const insert = deptInsert(LEGACY);
    expect((insert.column as unknown as { text: string }).text).toBe("");
    expect((insert.value as unknown as { text: string }).text).toBe("");
    expect(writeDepartmentId(LEGACY)).toBeNull();

    const total = await sql`SELECT count(*)::int AS n FROM master_data`;
    const scoped = await sql`SELECT m.item_id FROM master_data m WHERE m.is_active IS NOT FALSE${andDept(LEGACY, "m")}`;
    const viaWhere = await sql`SELECT m.item_id FROM master_data m WHERE ${deptWhere(LEGACY, "m")}`;
    expect(scoped).toHaveLength(Number(total[0].n));
    expect(viaWhere).toHaveLength(Number(total[0].n));
  });

  it.each([
    ["master_data", "m", "item_id"],
    ["vendors", "v", "name"],
    ["logs", "l", "id"],
  ])("one: only that department's %s rows", async (table, alias) => {
    const runWhere = (scope: DepartmentScope) =>
      sql`SELECT ${sql.unsafe(`${alias}.department_id`)} AS department_id FROM ${sql.unsafe(`${table} ${alias}`)} WHERE ${deptWhere(scope, alias)}`;
    const runAnd = (scope: DepartmentScope) =>
      sql`SELECT ${sql.unsafe(`${alias}.department_id`)} AS department_id FROM ${sql.unsafe(`${table} ${alias}`)} WHERE 1 = 1${andDept(scope, alias)}`;

    expectOnlyDepartment(await runWhere(ONE_A), DEPT_A);
    expectOnlyDepartment(await runWhere(ONE_B), DEPT_B);
    expectOnlyDepartment(await runAnd(ONE_A), DEPT_A);
    expectOnlyDepartment(await runAnd(ONE_B), DEPT_B);
  });

  it("works without an alias and combines with other parameters", async () => {
    const rows = await sql`SELECT item_id, department_id FROM master_data WHERE name LIKE ${"Dept%"}${andDept(ONE_B)}`;
    expect(rows.map((row) => row.item_id).sort()).toEqual(["MB-000001", "MB-000002"]);
    expectOnlyDepartment(rows, DEPT_B);
  });

  it("all: reads return both departments", async () => {
    const rows = await sql`SELECT DISTINCT m.department_id FROM master_data m WHERE ${deptWhere(ALL, "m")}${andDept(ALL, "m")} ORDER BY 1`;
    expect(rows.map((row) => row.department_id)).toEqual([DEPT_A, DEPT_B]);
  });

  it("all: writes throw DEPARTMENT_READ_ONLY", () => {
    expect(() => writeDepartmentId(ALL)).toThrowError(DepartmentScopeError);
    expect(() => writeDepartmentId(ALL)).toThrowError(expect.objectContaining({ code: "DEPARTMENT_READ_ONLY" }));
    expect(() => deptInsert(ALL)).toThrowError(expect.objectContaining({ code: "DEPARTMENT_READ_ONLY" }));
  });

  it("Write variants: all throws DEPARTMENT_READ_ONLY, even for UPDATE/DELETE", async () => {
    expect(() => deptWhereWrite(ALL, "m")).toThrowError(expect.objectContaining({ code: "DEPARTMENT_READ_ONLY" }));
    expect(() => andDeptWrite(ALL, "m")).toThrowError(expect.objectContaining({ code: "DEPARTMENT_READ_ONLY" }));
    const update = () => sql`UPDATE master_data m SET name = name WHERE m.item_id IS NOT NULL${andDeptWrite(ALL, "m")}`;
    const del = () => sql`DELETE FROM vendors v WHERE ${deptWhereWrite(ALL, "v")}`;
    expect(update).toThrowError(DepartmentScopeError);
    expect(del).toThrowError(DepartmentScopeError);
  });

  it("Write variants: one restricts rows, legacy is neutral", async () => {
    expect((deptWhereWrite(LEGACY, "m") as unknown as { text: string }).text).toBe("TRUE");
    expect((andDeptWrite(LEGACY, "m") as unknown as { text: string }).text).toBe("");

    await sql`INSERT INTO vendors (name, department_id) VALUES ('wr-a', ${DEPT_A}), ('wr-b', ${DEPT_B})`;
    await sql`UPDATE vendors v SET name = name || '-x' WHERE v.name LIKE 'wr-%'${andDeptWrite(ONE_B, "v")}`;
    expect((await sql`SELECT name FROM vendors WHERE name LIKE 'wr-%' ORDER BY name`).map((row) => row.name)).toEqual(["wr-a", "wr-b-x"]);
    await sql`DELETE FROM vendors v WHERE v.name LIKE 'wr-%' AND ${deptWhereWrite(ONE_A, "v")}`;
    expect((await sql`SELECT name FROM vendors WHERE name LIKE 'wr-%'`).map((row) => row.name)).toEqual(["wr-b-x"]);
    await sql`DELETE FROM vendors v WHERE v.name LIKE 'wr-%'${andDeptWrite(LEGACY, "v")}`; // legacy: no extra filter
    expect(await sql`SELECT name FROM vendors WHERE name LIKE 'wr-%'`).toHaveLength(0);
  });

  it("writeDepartmentId returns the id for one", () => {
    expect(writeDepartmentId(ONE_B)).toBe(DEPT_B);
  });

  it("rejects an unsafe alias, even for a neutral scope", () => {
    for (const bad of ["m; DROP TABLE logs", "M", "1m", "m.x", "", "a b", "a".repeat(32)]) {
      expect(() => deptWhere(ONE_A, bad)).toThrow(/Invalid SQL alias/);
      expect(() => andDept(ALL, bad)).toThrow(/Invalid SQL alias/);
    }
    expect(() => deptWhere(ONE_A, "a".repeat(31))).not.toThrow();
  });

  it("deptInsert puts the row in the chosen department", async () => {
    const { column, value } = deptInsert(ONE_B);
    await sql`INSERT INTO vendors (name${column}) VALUES (${"Inserted via deptInsert"}${value})`;
    const rows = await sql`SELECT department_id FROM vendors WHERE name = ${"Inserted via deptInsert"}`;
    expect(rows).toEqual([{ department_id: DEPT_B }]);
  });

  it("deptInsert in legacy leaves the column to its default (department 1)", async () => {
    const { column, value } = deptInsert(LEGACY);
    await sql`INSERT INTO vendors (name${column}) VALUES (${"Inserted legacy"}${value})`;
    const rows = await sql`SELECT department_id FROM vendors WHERE name = ${"Inserted legacy"}`;
    expect(rows).toEqual([{ department_id: DEPT_A }]);
  });
});

describe("departmentErrorResponse", () => {
  it("returns null for other errors", () => {
    expect(departmentErrorResponse(new Error("boom"))).toBeNull();
    expect(departmentErrorResponse("DEPARTMENT_NOT_FOUND")).toBeNull();
  });

  it("maps DEPARTMENT_NOT_FOUND to 404 with the request id", async () => {
    const response = departmentErrorResponse(new DepartmentScopeError("DEPARTMENT_NOT_FOUND"), "req-1");
    expect(response?.status).toBe(404);
    expect(response?.headers.get("x-request-id")).toBe("req-1");
    expect(await response?.json()).toMatchObject({ code: "DEPARTMENT_NOT_FOUND", requestId: "req-1" });
  });

  it("maps DEPARTMENT_READ_ONLY to 409", async () => {
    const response = departmentErrorResponse(new DepartmentScopeError("DEPARTMENT_READ_ONLY"), "req-2");
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ code: "DEPARTMENT_READ_ONLY", requestId: "req-2" });
  });

  it("maps DEPARTMENT_SCOPE_MISSING to a 500 INTERNAL_ERROR and logs the reason", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = departmentErrorResponse(new DepartmentScopeError("DEPARTMENT_SCOPE_MISSING", "no scope for bob"), "req-3");
      expect(response?.status).toBe(500);
      const body = await response?.json();
      expect(body).toMatchObject({ code: "INTERNAL_ERROR", requestId: "req-3" });
      expect(JSON.stringify(body)).not.toContain("bob");
      expect(error).toHaveBeenCalledWith(expect.stringContaining("no scope for bob"), expect.anything());
    } finally {
      error.mockRestore();
    }
  });

  it("generates a request id when none is given", async () => {
    const response = departmentErrorResponse(new DepartmentScopeError("DEPARTMENT_NOT_FOUND"));
    const body = await response?.json();
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(8);
  });
});
