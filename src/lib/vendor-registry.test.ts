import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  departmentsReady: vi.fn(),
  markDepartmentsNotReady: vi.fn(),
  statements: [] as string[],
  // Decides the rows (or an error) for a recorded statement.
  respond: null as null | ((text: string) => unknown[] | Error),
}));

vi.mock("@/lib/departments-flag", () => ({
  departmentsReady: m.departmentsReady,
  markDepartmentsNotReady: m.markDepartmentsNotReady,
  isMissingDepartmentSchemaError: (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? ""),
}));

vi.mock("@/lib/db", () => {
  type Q = PromiseLike<unknown[]> & { text: string; isQuery: true };
  const make = (text: string, top: boolean): Q => ({
    text,
    isQuery: true,
    then(onFulfilled, onRejected) {
      if (top) m.statements.push(text);
      const result = m.respond ? m.respond(text) : [];
      return result instanceof Error
        ? Promise.reject(result).then(onFulfilled, onRejected)
        : Promise.resolve(result).then(onFulfilled, onRejected);
    },
  });
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    values.forEach((value, i) => {
      text += (value as Q | null)?.isQuery ? (value as Q).text : "?";
      text += strings[i + 1];
    });
    return make(text.replace(/\s+/g, " ").trim(), true);
  }) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => make(text, false);
  return { default: fn };
});

import { findApprovedVendor, listApprovedVendorNames } from "./vendor-registry";

const LEGACY_LIST = "SELECT name FROM vendors WHERE is_approved = TRUE ORDER BY name ASC";
const LEGACY_FIND = "SELECT name FROM vendors WHERE LOWER(name) = LOWER(?) AND is_approved = TRUE LIMIT 1";

beforeEach(() => {
  vi.resetAllMocks();
  m.statements = [];
  m.respond = null;
  m.departmentsReady.mockResolvedValue(false);
});

describe("vendor-registry (unit)", () => {
  it("flag off: legacy statements run and none mentions department_id, departments or user_departments", async () => {
    m.respond = (text) => (text === LEGACY_LIST ? [{ name: "A" }, { name: "B" }] : [{ name: "Vendor A" }]);
    expect(await listApprovedVendorNames()).toEqual(["A", "B"]);
    await findApprovedVendor("vendor a");
    expect(m.statements).toEqual([LEGACY_LIST, LEGACY_FIND]);
    for (const text of m.statements) expect(text).not.toMatch(/department_id|departments|user_departments/i);
  });

  it("flag off: findApprovedVendor returns departmentId null", async () => {
    m.respond = () => [{ name: "Vendor A" }];
    expect(await findApprovedVendor("vendor a")).toEqual({ name: "Vendor A", departmentId: null });
  });

  it("flag off: findApprovedVendor returns null when nothing matches", async () => {
    m.respond = () => [];
    expect(await findApprovedVendor("nobody")).toBeNull();
  });

  it("schema error on the join marks departments not ready and falls back to the legacy query", async () => {
    m.departmentsReady.mockResolvedValue(true);
    m.respond = (text) => (/department_id/.test(text) ? Object.assign(new Error("missing"), { code: "42P01" }) : [{ name: "Vendor A" }]);
    expect(await findApprovedVendor("vendor a")).toEqual({ name: "Vendor A", departmentId: null });
    expect(m.markDepartmentsNotReady).toHaveBeenCalledTimes(1);
    expect(m.statements.at(-1)).toBe(LEGACY_FIND);

    m.respond = (text) => (/department_id/.test(text) ? Object.assign(new Error("missing"), { code: "42703" }) : [{ name: "A" }]);
    expect(await listApprovedVendorNames()).toEqual(["A"]);
    expect(m.markDepartmentsNotReady).toHaveBeenCalledTimes(2);
    expect(m.statements.at(-1)).toBe(LEGACY_LIST);
  });

  it("other errors on the join are not swallowed", async () => {
    m.departmentsReady.mockResolvedValue(true);
    m.respond = () => Object.assign(new Error("boom"), { code: "57014" });
    await expect(listApprovedVendorNames()).rejects.toThrow("boom");
    expect(m.markDepartmentsNotReady).not.toHaveBeenCalled();
  });
});
