import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));

vi.mock("./db", () => ({ default: mocks.sql }));

import {
  departmentsFlagOn,
  departmentsReady,
  isMissingDepartmentSchemaError,
  markDepartmentsNotReady,
  resetDepartmentsFlagForTests,
  setDepartmentsClockForTests,
} from "./departments-flag";

const READY_ROW = { has_user_departments: true, department_cols: 2, scoped_tables: 18, item_code_cols: 1, user_cols: 2 };

describe("departments flag", () => {
  let now = 1_000_000;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.sql.mockReset();
    now = 1_000_000;
    setDepartmentsClockForTests(() => now);
    resetDepartmentsFlagForTests();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.DEPARTMENTS_ENABLED;
  });

  afterEach(() => {
    delete process.env.DEPARTMENTS_ENABLED;
    setDepartmentsClockForTests();
    warn.mockRestore();
  });

  it("only the exact string 'true' turns the flag on", () => {
    expect(departmentsFlagOn()).toBe(false);
    for (const value of ["1", "TRUE", "yes", "", "false"]) {
      process.env.DEPARTMENTS_ENABLED = value;
      expect(departmentsFlagOn()).toBe(false);
    }
    process.env.DEPARTMENTS_ENABLED = "true";
    expect(departmentsFlagOn()).toBe(true);
  });

  it("flag off: false with no sql call at all, even after markDepartmentsNotReady", async () => {
    await expect(departmentsReady()).resolves.toBe(false);
    markDepartmentsNotReady("x");
    await expect(departmentsReady()).resolves.toBe(false);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("flag on + schema present: true, cached for 60 s then re-checked", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    mocks.sql.mockResolvedValue([READY_ROW]);
    await expect(departmentsReady()).resolves.toBe(true);
    await expect(departmentsReady()).resolves.toBe(true);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    now += 59_999;
    await departmentsReady();
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    now += 2;
    await departmentsReady();
    expect(mocks.sql).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("flag on + schema missing: false, one warning, failure cached for 60 s", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    mocks.sql.mockResolvedValue([{ ...READY_ROW, has_user_departments: false }]);
    await expect(departmentsReady()).resolves.toBe(false);
    await expect(departmentsReady()).resolves.toBe(false);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[departments] DEPARTMENTS_ENABLED but schema not ready");

    // After the period it re-checks and, if still missing, warns again (once per period).
    now += 60_001;
    await expect(departmentsReady()).resolves.toBe(false);
    expect(mocks.sql).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("each missing piece makes it not ready", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    for (const broken of [{ department_cols: 1 }, { scoped_tables: 17 }, { item_code_cols: 0 }, { user_cols: 1 }]) {
      resetDepartmentsFlagForTests();
      mocks.sql.mockResolvedValueOnce([{ ...READY_ROW, ...broken }]);
      await expect(departmentsReady()).resolves.toBe(false);
    }
  });

  it("a failing check never throws: false + warning (short retry, not cached for 60 s)", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    mocks.sql.mockRejectedValue(new Error("db down"));
    await expect(departmentsReady()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    mocks.sql.mockReset();
    resetDepartmentsFlagForTests();
    mocks.sql.mockResolvedValue([]);
    await expect(departmentsReady()).resolves.toBe(false);
  });

  it("transient probe error, never seen ready: false, retried after 5 s (not 60 s), warns once", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    mocks.sql.mockRejectedValue(new Error("fetch failed"));
    await expect(departmentsReady()).resolves.toBe(false);
    await expect(departmentsReady()).resolves.toBe(false);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    now += 5_001;
    await expect(departmentsReady()).resolves.toBe(false);
    expect(mocks.sql).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1); // once, not on every retry
    mocks.sql.mockResolvedValue([READY_ROW]);
    now += 5_001;
    await expect(departmentsReady()).resolves.toBe(true);
  });

  it("transient probe error after the system was seen ready: stays ready (no silent drop to legacy)", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    mocks.sql.mockResolvedValueOnce([READY_ROW]);
    await expect(departmentsReady()).resolves.toBe(true);
    mocks.sql.mockRejectedValue(new Error("timeout"));
    now += 60_001;
    await expect(departmentsReady()).resolves.toBe(true);
    now += 5_001;
    await expect(departmentsReady()).resolves.toBe(true);
    expect(mocks.sql).toHaveBeenCalledTimes(3);
  });

  it("a confirmed absence (probe sees it missing, or SQLSTATE 42P01 / 42703 from the probe) is cached for 60 s, even after being ready", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    mocks.sql.mockResolvedValueOnce([READY_ROW]);
    await expect(departmentsReady()).resolves.toBe(true);
    mocks.sql.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    now += 60_001;
    await expect(departmentsReady()).resolves.toBe(false);
    now += 30_000;
    await expect(departmentsReady()).resolves.toBe(false);
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });

  it("an in-flight probe cannot overwrite markDepartmentsNotReady", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    let release!: (rows: unknown[]) => void;
    mocks.sql.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const inFlight = departmentsReady();
    markDepartmentsNotReady("column missing");
    release([READY_ROW]);
    await expect(inFlight).resolves.toBe(false);
    await expect(departmentsReady()).resolves.toBe(false);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });

  it("resetDepartmentsFlagForTests is safe against an in-flight probe", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    let release!: (rows: unknown[]) => void;
    mocks.sql.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const stale = departmentsReady();
    resetDepartmentsFlagForTests();
    mocks.sql.mockResolvedValue([{ ...READY_ROW, has_user_departments: false }]);
    await expect(departmentsReady()).resolves.toBe(false); // fresh probe
    release([READY_ROW]); // the old probe finishes later with "ready"
    await stale;
    await expect(departmentsReady()).resolves.toBe(false); // still the fresh answer
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });

  it("concurrent callers share one check", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    mocks.sql.mockResolvedValue([READY_ROW]);
    await Promise.all([departmentsReady(), departmentsReady(), departmentsReady()]);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });

  it("markDepartmentsNotReady turns a ready system off for 60 s and warns once", async () => {
    process.env.DEPARTMENTS_ENABLED = "true";
    mocks.sql.mockResolvedValue([READY_ROW]);
    await expect(departmentsReady()).resolves.toBe(true);
    markDepartmentsNotReady("column missing");
    markDepartmentsNotReady("column missing again");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("column missing");
    await expect(departmentsReady()).resolves.toBe(false);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    now += 60_001;
    await expect(departmentsReady()).resolves.toBe(true);
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });

  it("recognises missing table / column errors", () => {
    expect(isMissingDepartmentSchemaError({ code: "42P01" })).toBe(true);
    expect(isMissingDepartmentSchemaError({ code: "42703" })).toBe(true);
    expect(isMissingDepartmentSchemaError({ cause: { code: "42703" } })).toBe(true);
    expect(isMissingDepartmentSchemaError({ code: "23505" })).toBe(false);
    expect(isMissingDepartmentSchemaError(new Error("x"))).toBe(false);
    expect(isMissingDepartmentSchemaError(null)).toBe(false);
  });
});
