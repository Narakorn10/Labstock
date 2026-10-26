import { beforeEach, describe, expect, it, vi } from "vitest";

// The department step of getLinePurchasingUserFromRequest (departments on). The statements of the legacy path are pinned by
// src/app/api/liff/orders/liff-orders.legacy.test.ts; the real SQL of the lookup by liff-orders.dept.db.test.ts.

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  verifyLineIdToken: vi.fn(),
  hasUserLineIdColumn: vi.fn(),
  getLineLinkedPurchasingUser: vi.fn(),
  resolveDepartmentForLineUser: vi.fn(),
  departmentsReady: vi.fn(),
  markDepartmentsNotReady: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/line-liff-auth", () => ({
  verifyLineIdToken: mocks.verifyLineIdToken,
  hasUserLineIdColumn: mocks.hasUserLineIdColumn,
  getLineLinkedPurchasingUser: mocks.getLineLinkedPurchasingUser,
}));
vi.mock("@/lib/department-context", () => ({ resolveDepartmentForLineUser: mocks.resolveDepartmentForLineUser }));
vi.mock("@/lib/departments-flag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/departments-flag")>()),
  departmentsReady: mocks.departmentsReady,
  markDepartmentsNotReady: mocks.markDepartmentsNotReady,
}));

import { getLinePurchasingUserFromRequest } from "./line-liff-ordering";

const linked = { username: "mgr", name: "Manager", role: "Manager", vendor: undefined };
const scoped = (extra: Record<string, unknown> = {}) => ({ username: "mgr", name: "Manager", role: "Manager", globalRole: "Manager", departmentId: 2, departmentCode: "MB", scope: 2, ...extra });
const call = () => getLinePurchasingUserFromRequest(new Request("http://localhost/api/liff/orders", { method: "POST", body: JSON.stringify({ idToken: "t", vendor: "V" }) }));
const noWork = "บัญชีนี้ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ";
const notAllowed = "Only linked Admin or Manager users can order reagents from LINE.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyLineIdToken.mockResolvedValue({ sub: "U-1" });
  mocks.hasUserLineIdColumn.mockResolvedValue(true);
  mocks.getLineLinkedPurchasingUser.mockResolvedValue(linked);
  mocks.departmentsReady.mockResolvedValue(true);
  mocks.resolveDepartmentForLineUser.mockResolvedValue(scoped());
});

describe("getLinePurchasingUserFromRequest with departments on", () => {
  it("a normal Manager gets the scoped user (the LINE id and the linked username are passed to the lookup)", async () => {
    const result = await call();
    expect(result).toMatchObject({ ok: true, lineUserId: "U-1", user: scoped() });
    expect(mocks.resolveDepartmentForLineUser).toHaveBeenCalledWith("U-1", "mgr");
  });

  it("an Admin keeps working (role Admin in its default department)", async () => {
    mocks.getLineLinkedPurchasingUser.mockResolvedValue({ ...linked, username: "adm", role: "Admin" });
    mocks.resolveDepartmentForLineUser.mockResolvedValue(scoped({ username: "adm", role: "Admin", globalRole: "Admin" }));
    await expect(call()).resolves.toMatchObject({ ok: true, user: { username: "adm", role: "Admin", scope: 2 } });
  });

  it("no usable department (null) answers 403 with the Thai message", async () => {
    mocks.resolveDepartmentForLineUser.mockResolvedValue(null);
    const result = await call();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({ error: noWork });
  });

  it.each(["User", "Vendor", "Operator"])("a per-department role override of %s cannot order (403)", async (role) => {
    mocks.resolveDepartmentForLineUser.mockResolvedValue(scoped({ role }));
    const result = await call();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({ error: notAllowed });
  });

  it("a global Vendor is refused even if the department role looks like Manager", async () => {
    mocks.resolveDepartmentForLineUser.mockResolvedValue(scoped({ role: "Manager", globalRole: "Vendor" }));
    const result = await call();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  it("a missing department schema (42P01 / 42703) falls back to the legacy user and warns once", async () => {
    for (const code of ["42P01", "42703"]) {
      mocks.markDepartmentsNotReady.mockClear();
      mocks.resolveDepartmentForLineUser.mockRejectedValueOnce(Object.assign(new Error("missing"), { code }));
      const result = await call();
      expect(result).toMatchObject({ ok: true, user: linked });
      expect(result.ok && "scope" in result.user).toBe(false);
      expect(mocks.markDepartmentsNotReady).toHaveBeenCalledWith("liff ordering lookup failed; using legacy path");
    }
  });

  it("any other database error is rethrown (the route answers 500)", async () => {
    mocks.resolveDepartmentForLineUser.mockRejectedValue(Object.assign(new Error("boom"), { code: "57014" }));
    await expect(call()).rejects.toThrow("boom");
    expect(mocks.markDepartmentsNotReady).not.toHaveBeenCalled();
  });
});

describe("getLinePurchasingUserFromRequest with departments off", () => {
  it("returns the linked user untouched and never calls the lookup", async () => {
    mocks.departmentsReady.mockResolvedValue(false);
    const result = await call();
    expect(result).toMatchObject({ ok: true, user: linked });
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
  });

  it("the system role gate runs first: an unlinked / non-ordering account is refused before any department lookup", async () => {
    mocks.getLineLinkedPurchasingUser.mockResolvedValue(null);
    const result = await call();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(mocks.departmentsReady).not.toHaveBeenCalled();
    expect(mocks.resolveDepartmentForLineUser).not.toHaveBeenCalled();
  });
});
