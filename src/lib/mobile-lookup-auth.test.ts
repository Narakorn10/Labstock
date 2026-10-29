import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  resolve: vi.fn(),
  departmentsReady: vi.fn(),
  markDepartmentsNotReady: vi.fn(),
  verifyLineIdToken: vi.fn(),
  getLineLinkedUser: vi.fn(),
  hasUserLineIdColumn: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: m.getAuthenticatedUser }));
vi.mock("@/lib/department-context", () => ({ resolveDepartmentForVerifiedUser: m.resolve }));
vi.mock("@/lib/departments-flag", () => ({
  departmentsReady: m.departmentsReady,
  markDepartmentsNotReady: m.markDepartmentsNotReady,
  isMissingDepartmentSchemaError: (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? ""),
}));
vi.mock("@/lib/line-liff-auth", () => ({
  verifyLineIdToken: m.verifyLineIdToken,
  getLineLinkedUser: m.getLineLinkedUser,
  hasUserLineIdColumn: m.hasUserLineIdColumn,
}));

import { authenticateMobileLookup, LINE_ID_TOKEN_HEADER } from "./mobile-lookup-auth";

const req = (headers: Record<string, string> = {}) => new Request("http://test/api/mobile/lookup", { headers });
const lineReq = () => req({ [LINE_ID_TOKEN_HEADER]: "tok" });
const bodyOf = async (r: Response) => ({ status: r.status, json: await r.json() });
const scopedUser = { username: "u1", name: "U One", role: "User", vendor: "", globalRole: "User", departmentId: 1, departmentCode: "CC", scope: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  m.departmentsReady.mockResolvedValue(true);
  m.hasUserLineIdColumn.mockResolvedValue(true);
  m.verifyLineIdToken.mockResolvedValue({ sub: "U-line" });
});

describe("authenticateMobileLookup", () => {
  it("no header and no session gives 401 without touching department code", async () => {
    m.getAuthenticatedUser.mockResolvedValue(null);
    const result = await authenticateMobileLookup(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await bodyOf(result.response)).toEqual({ status: 401, json: { error: "Please sign in." } });
    expect(m.departmentsReady).not.toHaveBeenCalled();
    expect(m.resolve).not.toHaveBeenCalled();
  });

  it("session user is resolved with resolveDepartmentForVerifiedUser and its result is returned", async () => {
    const session = { username: "u1", name: "U One", role: "User", scope: "ALL" };
    m.getAuthenticatedUser.mockResolvedValue(session);
    m.resolve.mockResolvedValue(scopedUser);
    const result = await authenticateMobileLookup(req());
    expect(m.resolve).toHaveBeenCalledWith(session);
    expect(result).toEqual({ ok: true, user: scopedUser });
  });

  it("session whose resolver returns null gives 401", async () => {
    m.getAuthenticatedUser.mockResolvedValue({ username: "u1", name: "U", role: "User" });
    m.resolve.mockResolvedValue(null);
    const result = await authenticateMobileLookup(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect((await bodyOf(result.response)).status).toBe(401);
  });

  it("LINE user whose resolver returns null gives 403 with the no-department message", async () => {
    m.getLineLinkedUser.mockResolvedValue({ username: "u1", name: "U", role: "User" });
    m.resolve.mockResolvedValue(null);
    const result = await authenticateMobileLookup(lineReq());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(await bodyOf(result.response)).toEqual({ status: 403, json: { error: "บัญชีนี้ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ" } });
    }
  });

  it("LINE header wins over a session of another user", async () => {
    const lineUser = { username: "line-user", name: "L", role: "User" };
    m.getAuthenticatedUser.mockResolvedValue({ username: "session-user", name: "S", role: "Admin" });
    m.getLineLinkedUser.mockResolvedValue(lineUser);
    m.resolve.mockResolvedValue({ ...scopedUser, username: "line-user" });
    const result = await authenticateMobileLookup(lineReq());
    expect(m.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(m.getLineLinkedUser).toHaveBeenCalledWith("U-line");
    expect(m.resolve).toHaveBeenCalledWith(lineUser);
    expect(result.ok && result.user.username).toBe("line-user");
  });

  it("invalid LINE token gives 401 and does not fall back to the session", async () => {
    m.verifyLineIdToken.mockResolvedValue(null);
    m.getAuthenticatedUser.mockResolvedValue({ username: "session-user", name: "S", role: "User" });
    const result = await authenticateMobileLookup(lineReq());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await bodyOf(result.response)).toEqual({ status: 401, json: { error: "LINE authentication failed." } });
    expect(m.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(m.departmentsReady).not.toHaveBeenCalled();
  });

  it("unlinked LINE account gives 401", async () => {
    m.getLineLinkedUser.mockResolvedValue(null);
    const result = await authenticateMobileLookup(lineReq());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await bodyOf(result.response)).toEqual({ status: 401, json: { error: "This LINE account is not linked to a LabStock user." } });
    expect(m.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(m.resolve).not.toHaveBeenCalled();
  });

  it("LINE column missing gives 400 like confirm", async () => {
    m.hasUserLineIdColumn.mockResolvedValue(false);
    const result = await authenticateMobileLookup(lineReq());
    expect(result.ok).toBe(false);
    if (!result.ok) expect((await bodyOf(result.response)).status).toBe(400);
    expect(m.getLineLinkedUser).not.toHaveBeenCalled();
  });

  it("vendor gives 403", async () => {
    m.getAuthenticatedUser.mockResolvedValue({ username: "v", name: "V", role: "Vendor" });
    const result = await authenticateMobileLookup(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect((await bodyOf(result.response)).status).toBe(403);
    expect(m.resolve).not.toHaveBeenCalled();
  });

  it("vendor role inside the department gives 403", async () => {
    m.getAuthenticatedUser.mockResolvedValue({ username: "u1", name: "U", role: "User" });
    m.resolve.mockResolvedValue({ ...scopedUser, role: "Vendor", globalRole: "User" });
    const result = await authenticateMobileLookup(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await bodyOf(result.response)).toEqual({ status: 403, json: { error: "This role cannot approve mobile stock transactions." } });
  });

  it("flag off: no resolver call and scope fields are dropped from the returned user", async () => {
    m.departmentsReady.mockResolvedValue(false);
    m.getAuthenticatedUser.mockResolvedValue({ ...scopedUser, scope: "ALL", activeDepartment: 2, vendor: "V1" });
    const result = await authenticateMobileLookup(req());
    expect(m.resolve).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, user: { username: "u1", name: "U One", role: "User", vendor: "V1" } });
    expect(result.ok && Object.keys(result.user).sort()).toEqual(["name", "role", "username", "vendor"]);
  });

  it("schema error from the resolver marks departments not ready and returns the unscoped user", async () => {
    m.getAuthenticatedUser.mockResolvedValue({ ...scopedUser, scope: "ALL" });
    m.resolve.mockRejectedValue(Object.assign(new Error("undefined column"), { code: "42703" }));
    const result = await authenticateMobileLookup(req());
    expect(m.markDepartmentsNotReady).toHaveBeenCalledWith("mobile lookup department resolution failed; using legacy path");
    expect(result).toEqual({ ok: true, user: { username: "u1", name: "U One", role: "User", vendor: "" } });
  });

  it("schema error thrown by getLineLinkedUser does NOT call markDepartmentsNotReady", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.getLineLinkedUser.mockRejectedValue(Object.assign(new Error("undefined column"), { code: "42703" }));
    const result = await authenticateMobileLookup(lineReq());
    expect(m.markDepartmentsNotReady).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await bodyOf(result.response)).toEqual({ status: 500, json: { error: "Unable to verify your account." } });
  });

  it("unexpected resolver error gives 500 with a fixed body that contains no username", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.getAuthenticatedUser.mockResolvedValue({ username: "secret-name", name: "S", role: "User" });
    m.resolve.mockRejectedValue(new Error("boom for secret-name"));
    const result = await authenticateMobileLookup(req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const { status, json } = await bodyOf(result.response);
      expect(status).toBe(500);
      expect(JSON.stringify(json)).not.toContain("secret-name");
      expect(m.markDepartmentsNotReady).not.toHaveBeenCalled();
    }
  });
});
