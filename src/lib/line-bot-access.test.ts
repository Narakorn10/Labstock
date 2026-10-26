import { beforeEach, describe, expect, it, vi } from "vitest";

// The LINE bot gate (departments on/off, link, role, one default department). The real SQL of the lookup is pinned elsewhere;
// here only the decision order and the returned state are checked.

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
  mocks.departmentsReady.mockResolvedValue(true);
  mocks.getLineLinkedUserAccess.mockResolvedValue({ state: "active", user: linkedUser });
  mocks.resolveDepartmentForLineUser.mockResolvedValue(scoped());
});

describe("getLineBotAccess", () => {
  it("switch off returns legacy without any query", async () => {
    mocks.departmentsReady.mockResolvedValue(false);
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "legacy" });
    expect(mocks.getLineLinkedUserAccess).not.toHaveBeenCalled();
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
  });

  it("null lineUserId with switch on is unlinked", async () => {
    await expect(getLineBotAccess(null)).resolves.toEqual({ state: "unlinked" });
    expect(mocks.getLineLinkedUserAccess).not.toHaveBeenCalled();
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
  });

  it.each(["unlinked", "inactive"])("a %s account is unlinked", async (state) => {
    mocks.getLineLinkedUserAccess.mockResolvedValue({ state, user: state === "inactive" ? linkedUser : null });
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

  it("missing schema error falls back to legacy and marks not ready", async () => {
    mocks.resolveDepartmentForLineUser.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));
    await expect(getLineBotAccess("U-1")).resolves.toEqual({ state: "legacy" });
    expect(mocks.markDepartmentsNotReady).toHaveBeenCalledTimes(1);
  });

  it("other errors rethrow", async () => {
    mocks.resolveDepartmentForLineUser.mockRejectedValue(Object.assign(new Error("boom"), { code: "57014" }));
    await expect(getLineBotAccess("U-1")).rejects.toThrow("boom");
    expect(mocks.markDepartmentsNotReady).not.toHaveBeenCalled();
  });
});
