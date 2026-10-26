import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The LINE bot gate (switch on/off, departments ready or not, link, role, one default department). The real SQL of the lookup is
// pinned elsewhere; here only the decision order and the returned state are checked.

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  getLineLinkedUserAccess: vi.fn(),
  resolveDepartmentForLineUser: vi.fn(),
  departmentsReady: vi.fn(),
  markDepartmentsNotReady: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/line-liff-auth", () => ({
  verifyLineIdToken: vi.fn(),
  hasUserLineIdColumn: vi.fn(),
  getLineLinkedPurchasingUser: vi.fn(),
  getLineLinkedUserAccess: mocks.getLineLinkedUserAccess,
}));
vi.mock("@/lib/department-context", () => ({ resolveDepartmentForLineUser: mocks.resolveDepartmentForLineUser }));
vi.mock("@/lib/departments-flag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/departments-flag")>()),
  departmentsReady: mocks.departmentsReady,
  markDepartmentsNotReady: mocks.markDepartmentsNotReady,
}));

import { getLineBotAccess } from "./line-liff-ordering";

const linkedUser = { username: "mgr", name: "Manager", role: "Manager", vendor: undefined };
const scoped = (extra: Record<string, unknown> = {}) => ({ username: "mgr", name: "Manager", role: "Manager", globalRole: "Manager", departmentId: 2, departmentCode: "MB", scope: 2, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEPARTMENTS_ENABLED", "true");
  mocks.departmentsReady.mockResolvedValue(true);
  mocks.getLineLinkedUserAccess.mockResolvedValue({ state: "active", user: linkedUser });
  mocks.resolveDepartmentForLineUser.mockResolvedValue(scoped());
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("getLineBotAccess", () => {
  it.each([[undefined], ["false"], ["1"]])("switch off (DEPARTMENTS_ENABLED=%s) returns legacy without any query", async (value) => {
    vi.stubEnv("DEPARTMENTS_ENABLED", value);
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "legacy" });
    await expect(getLineBotAccess(null)).resolves.toEqual({ state: "legacy" });
    expect(mocks.departmentsReady).not.toHaveBeenCalled();
    expect(mocks.getLineLinkedUserAccess).not.toHaveBeenCalled();
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("null lineUserId with switch on is unlinked", async () => {
    await expect(getLineBotAccess(null)).resolves.toEqual({ state: "unlinked" });
    expect(mocks.getLineLinkedUserAccess).not.toHaveBeenCalled();
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
  });

  it.each([
    ["unlinked", { state: "unlinked" }],
    ["inactive", { state: "inactive", accountStatus: "disabled" }],
  ])("a %s account is unlinked", async (_name, access) => {
    mocks.getLineLinkedUserAccess.mockResolvedValue(access);
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "unlinked" });
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
  });

  it("Vendor returns vendor state without resolving a department", async () => {
    mocks.getLineLinkedUserAccess.mockResolvedValue({ state: "active", user: { ...linkedUser, role: "Vendor", vendor: "V" } });
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "vendor", vendor: "V" });
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
  });

  it("Vendor with null vendor becomes empty string", async () => {
    mocks.getLineLinkedUserAccess.mockResolvedValue({ state: "active", user: { ...linkedUser, role: "Vendor", vendor: null } });
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "vendor", vendor: "" });
  });

  it("lab user returns effective role and one-scope", async () => {
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "lab", role: "Manager", scope: { mode: "one", departmentId: 2 } });
    expect(mocks.resolveDepartmentForLineUser).toHaveBeenCalledWith("U-1", "mgr");
  });

  it("per-department override User is reported as User", async () => {
    mocks.resolveDepartmentForLineUser.mockResolvedValue(scoped({ role: "User" }));
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "lab", role: "User", scope: { mode: "one", departmentId: 2 } });
  });

  it("resolve null is no_work", async () => {
    mocks.resolveDepartmentForLineUser.mockResolvedValue(null);
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "no_work" });
  });

  it("resolved globalRole Vendor is unlinked", async () => {
    mocks.resolveDepartmentForLineUser.mockResolvedValue(scoped({ globalRole: "Vendor" }));
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "unlinked" });
  });

  it.each(["ALL", null])("a resolved scope of %j is no_work (never a lab scope)", async (scope) => {
    mocks.resolveDepartmentForLineUser.mockResolvedValue(scoped({ scope }));
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "no_work" });
  });

  it.each(["42P01", "42703"])("missing schema error %s falls back to degraded (never legacy) and marks not ready", async (code) => {
    mocks.resolveDepartmentForLineUser.mockRejectedValue(Object.assign(new Error("missing"), { code }));
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "degraded", role: "Manager" });
    expect(mocks.markDepartmentsNotReady).toHaveBeenCalledTimes(1);
  });

  it.each(["42P01", "42703"])("missing schema error %s keeps the effective account role of a User in degraded", async (code) => {
    mocks.getLineLinkedUserAccess.mockResolvedValue({ state: "active", user: { ...linkedUser, role: "User" } });
    mocks.resolveDepartmentForLineUser.mockRejectedValue(Object.assign(new Error("missing"), { code }));
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "degraded", role: "User" });
  });

  it("other errors rethrow", async () => {
    mocks.resolveDepartmentForLineUser.mockRejectedValue(Object.assign(new Error("boom"), { code: "57014" }));
    await expect(getLineBotAccess("U-1")).rejects.toThrow("boom");
    expect(mocks.markDepartmentsNotReady).not.toHaveBeenCalled();
  });
});

// Switch ON but the department schema is not ready (probe failed, or a route called markDepartmentsNotReady). The identity check
// still applies (unlinked users must never see data while the switch is on); only the department lookup is skipped.
describe("getLineBotAccess, switch on but departments not ready", () => {
  beforeEach(() => {
    mocks.departmentsReady.mockResolvedValue(false);
  });

  it("null lineUserId is unlinked", async () => {
    await expect(getLineBotAccess(null)).resolves.toEqual({ state: "unlinked" });
    expect(mocks.getLineLinkedUserAccess).not.toHaveBeenCalled();
  });

  it.each([
    ["unlinked", { state: "unlinked" }],
    ["inactive", { state: "inactive", accountStatus: "disabled" }],
  ])("a %s account is unlinked", async (_name, access) => {
    mocks.getLineLinkedUserAccess.mockResolvedValue(access);
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "unlinked" });
    expect(mocks.getLineLinkedUserAccess).toHaveBeenCalledWith("U-1");
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
  });

  it("Vendor returns vendor state", async () => {
    mocks.getLineLinkedUserAccess.mockResolvedValue({ state: "active", user: { ...linkedUser, role: "Vendor", vendor: "V" } });
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "vendor", vendor: "V" });
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
  });

  it.each(["Manager", "Admin", "User", "Operator", "Technician"])("linked %s is degraded with the account role and no department lookup", async (role) => {
    mocks.getLineLinkedUserAccess.mockResolvedValue({ state: "active", user: { ...linkedUser, role } });
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "degraded", role });
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
    expect(mocks.markDepartmentsNotReady).not.toHaveBeenCalled();
  });

  it("control: the same Manager with departments ready is a lab user", async () => {
    mocks.departmentsReady.mockResolvedValue(true);
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "lab", role: "Manager", scope: { mode: "one", departmentId: 2 } });
  });
});
