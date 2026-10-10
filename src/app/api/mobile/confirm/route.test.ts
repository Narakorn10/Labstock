import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([]),
  hasUserPinColumn: vi.fn(),
  verifyUserPin: vi.fn(),
  roleHasMenu: vi.fn(),
  verifyLineIdToken: vi.fn(),
  getLineLinkedUser: vi.fn(),
  hasUserLineIdColumn: vi.fn(),
  departmentsReady: vi.fn(async () => false),
  markDepartmentsNotReady: vi.fn(),
  resolveDepartmentForVerifiedUser: vi.fn(),
  runReceiveBatch: vi.fn(),
  runDispenseBatch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({
  hasUserPinColumn: mocks.hasUserPinColumn,
  verifyUserPin: mocks.verifyUserPin,
  roleHasMenu: mocks.roleHasMenu,
}));
vi.mock("@/lib/line-liff-auth", () => ({
  verifyLineIdToken: mocks.verifyLineIdToken,
  getLineLinkedUser: mocks.getLineLinkedUser,
  hasUserLineIdColumn: mocks.hasUserLineIdColumn,
}));
// Real isMissingDepartmentSchemaError; only the flag reads are replaced.
vi.mock("@/lib/departments-flag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/departments-flag")>()),
  departmentsReady: mocks.departmentsReady,
  markDepartmentsNotReady: (reason: string) => {
    mocks.markDepartmentsNotReady(reason);
    mocks.departmentsReady.mockResolvedValue(false);
  },
}));
vi.mock("@/lib/department-context", () => ({ resolveDepartmentForVerifiedUser: mocks.resolveDepartmentForVerifiedUser }));
vi.mock("@/lib/stock-transactions", () => ({
  runReceiveBatch: mocks.runReceiveBatch,
  runDispenseBatch: mocks.runDispenseBatch,
}));

import { AppError } from "@/lib/errors";
import { DepartmentScopeError } from "@/lib/scoped-db";
import { POST } from "./route";

const item = [{ reagentId: "R1", quantity: 1 }];
const post = (body: Record<string, unknown>) =>
  POST(new Request("http://test/api/mobile/confirm", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/mobile/confirm menu RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasUserPinColumn.mockResolvedValue(true);
    mocks.hasUserLineIdColumn.mockResolvedValue(true);
    mocks.runReceiveBatch.mockResolvedValue({ success: true });
    mocks.runDispenseBatch.mockResolvedValue({ success: true });
  });

  it("blocks a PIN-approved receive when the role lacks the receive menu", async () => {
    mocks.verifyUserPin.mockResolvedValue({ username: "op", name: "Op", role: "Operator" });
    mocks.roleHasMenu.mockResolvedValue(false);

    const response = await post({ mode: "receive", username: "op", pin: "1234", batchItems: item });

    expect(response.status).toBe(403);
    expect(mocks.roleHasMenu).toHaveBeenCalledWith("Operator", "receive");
    expect(mocks.runReceiveBatch).not.toHaveBeenCalled();
  });

  it("blocks a LINE-approved dispense when the role lacks the dispense menu", async () => {
    mocks.verifyLineIdToken.mockResolvedValue({ sub: "U1" });
    mocks.getLineLinkedUser.mockResolvedValue({ username: "u", name: "U", role: "User" });
    mocks.roleHasMenu.mockResolvedValue(false);

    const response = await post({ mode: "dispense", lineIdToken: "token", batchItems: item });

    expect(response.status).toBe(403);
    expect(mocks.roleHasMenu).toHaveBeenCalledWith("User", "dispense");
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });

  it("runs the batch when the role has the menu", async () => {
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager" });
    mocks.roleHasMenu.mockResolvedValue(true);

    const response = await post({ mode: "receive", username: "mt", pin: "1234", batchItems: item });

    expect(response.status).toBe(200);
    expect(mocks.roleHasMenu).toHaveBeenCalledWith("Manager", "receive");
    expect(mocks.runReceiveBatch).toHaveBeenCalledTimes(1);
  });

  it("still refuses Vendors before checking menus", async () => {
    mocks.verifyUserPin.mockResolvedValue({ username: "v", name: "V", role: "Vendor" });

    const response = await post({ mode: "dispense", username: "v", pin: "1234", batchItems: item });

    expect(response.status).toBe(403);
    expect(mocks.roleHasMenu).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/confirm batch error mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasUserPinColumn.mockResolvedValue(true);
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager" });
    mocks.roleHasMenu.mockResolvedValue(true);
  });

  const confirm = () => post({ mode: "dispense", username: "mt", pin: "1234", batchItems: item });

  it("maps REAGENT_INACTIVE to 409 with the raw error message", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new AppError("REAGENT_INACTIVE", { detail: "REAGENT_INACTIVE: R1" }));

    const response = await confirm();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "REAGENT_INACTIVE: R1" });
  });

  it("maps a plain Error to 400 with its message", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new Error("boom"));

    const response = await confirm();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "boom" });
  });

  it("maps REAGENT_STOCK_INSUFFICIENT to 400 with the raw message (not 409 as the catalogue status says)", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new AppError("REAGENT_STOCK_INSUFFICIENT", { detail: "REAGENT_STOCK_INSUFFICIENT: R1" }));

    const response = await confirm();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "REAGENT_STOCK_INSUFFICIENT: R1" });
  });
});

describe("POST /api/mobile/confirm dispense department scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.hasUserPinColumn.mockResolvedValue(true);
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager" });
    mocks.roleHasMenu.mockResolvedValue(true);
  });

  const confirm = () => post({ mode: "dispense", username: "mt", pin: "1234", batchItems: item });

  it("passes { mode: \"legacy\" } as the 4th argument when the flag is off (user has no scope)", async () => {
    mocks.runDispenseBatch.mockResolvedValue({ success: true });

    const response = await confirm();

    expect(response.status).toBe(200);
    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(item, expect.objectContaining({ username: "mt" }), expect.any(Object), { mode: "legacy" });
  });

  it("passes { mode: \"one\", departmentId } when the approver has a department scope", async () => {
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager", scope: 2 });
    mocks.runDispenseBatch.mockResolvedValue({ success: true });

    await confirm();

    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(item, expect.anything(), expect.any(Object), { mode: "one", departmentId: 2 });
  });

  it("maps AppError ITEM_NOT_IN_DEPARTMENT to 409 with a Thai message", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new AppError("ITEM_NOT_IN_DEPARTMENT", {
      message: "รายการนี้ไม่อยู่ในงานของคุณ (R1)",
      detail: "ITEM_NOT_IN_DEPARTMENT: R1",
    }));

    const response = await confirm();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("รายการนี้ไม่อยู่ในงานของคุณ");
  });

  it("maps a raw ITEM_NOT_IN_DEPARTMENT error (from labstock_assert) to 409 with the item id", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new Error("ITEM_NOT_IN_DEPARTMENT: X"));

    const response = await confirm();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("รายการนี้ไม่อยู่ในงานของคุณ (X)");
  });

  it("maps DEPARTMENT_READ_ONLY to 409", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new DepartmentScopeError("DEPARTMENT_READ_ONLY"));

    const response = await confirm();

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEPARTMENT_READ_ONLY");
  });

  it("answers 404 and never dispenses when the approver asked for a department they are not in", async () => {
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager", scope: 2, departmentDenied: true });

    const response = await confirm();

    expect(response.status).toBe(404);
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/confirm receive department scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.hasUserPinColumn.mockResolvedValue(true);
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager" });
    mocks.roleHasMenu.mockResolvedValue(true);
  });

  const confirm = () => post({ mode: "receive", username: "mt", pin: "1234", batchItems: item });

  it("passes { mode: \"legacy\" } as the 4th argument when the flag is off (user has no scope)", async () => {
    mocks.runReceiveBatch.mockResolvedValue({ success: true });

    const response = await confirm();

    expect(response.status).toBe(200);
    expect(mocks.runReceiveBatch).toHaveBeenCalledWith(item, expect.objectContaining({ username: "mt" }), expect.any(Object), { mode: "legacy" });
  });

  it("passes { mode: \"one\", departmentId } when the approver has a department scope", async () => {
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager", scope: 2 });
    mocks.runReceiveBatch.mockResolvedValue({ success: true });

    await confirm();

    expect(mocks.runReceiveBatch).toHaveBeenCalledWith(item, expect.anything(), expect.any(Object), { mode: "one", departmentId: 2 });
  });

  it("maps AppError ITEM_NOT_IN_DEPARTMENT to 409 with a Thai message", async () => {
    mocks.runReceiveBatch.mockRejectedValue(new AppError("ITEM_NOT_IN_DEPARTMENT", {
      message: "รายการนี้ไม่อยู่ในงานของคุณ (R1)",
      detail: "ITEM_NOT_IN_DEPARTMENT: R1",
    }));

    const response = await confirm();

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("รายการนี้ไม่อยู่ในงานของคุณ");
  });

  it("maps DEPARTMENT_READ_ONLY to 409 and a denied department to 404 without receiving", async () => {
    mocks.runReceiveBatch.mockRejectedValue(new DepartmentScopeError("DEPARTMENT_READ_ONLY"));
    expect((await confirm()).status).toBe(409);

    mocks.runReceiveBatch.mockClear();
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager", scope: 2, departmentDenied: true });
    expect((await confirm()).status).toBe(404);
    expect(mocks.runReceiveBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/confirm flag off: successful response is unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasUserPinColumn.mockResolvedValue(true);
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager" });
    mocks.roleHasMenu.mockResolvedValue(true);
  });

  it.each(["receive", "dispense"] as const)("%s returns the run result plus the approver", async (mode) => {
    mocks.runReceiveBatch.mockResolvedValue({ success: true, message: "ok" });
    mocks.runDispenseBatch.mockResolvedValue({ success: true, message: "ok" });

    const response = await post({ mode, username: "mt", pin: "1234", batchItems: item });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: "ok", approver: { username: "mt", name: "MT", role: "Manager" } });
    const run = mode === "receive" ? mocks.runReceiveBatch : mocks.runDispenseBatch;
    expect(run).toHaveBeenCalledWith(item, expect.anything(), expect.any(Object), { mode: "legacy" });
  });
});

// Departments ON: the approver is verified by PIN / LINE first, then resolveDepartmentForVerifiedUser decides the
// department (never the request). `getDepartmentScope` stays the real one, so a user that comes back without a scope
// still fails closed.
describe("POST /api/mobile/confirm with departments on (resolveDepartmentForVerifiedUser)", () => {
  const verifiedUser = { username: "user1", name: "User One", role: "Manager", globalRole: "Manager" };
  const scopedUser = (extra: Record<string, unknown> = {}) => ({ ...verifiedUser, role: "Technician", scope: 2, departmentId: 2, departmentCode: "MB", ...extra });
  const sqlValues = () => mocks.sql.mock.calls.flatMap((call) => call.slice(1));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.hasUserPinColumn.mockResolvedValue(true);
    mocks.hasUserLineIdColumn.mockResolvedValue(true);
    mocks.roleHasMenu.mockResolvedValue(true);
    mocks.verifyUserPin.mockResolvedValue(verifiedUser);
    mocks.verifyLineIdToken.mockResolvedValue({ sub: "U1" });
    mocks.getLineLinkedUser.mockResolvedValue(verifiedUser);
    mocks.runReceiveBatch.mockResolvedValue({ success: true });
    mocks.runDispenseBatch.mockResolvedValue({ success: true });
    mocks.departmentsReady.mockResolvedValue(true);
    mocks.resolveDepartmentForVerifiedUser.mockReset();
    mocks.resolveDepartmentForVerifiedUser.mockResolvedValue(scopedUser());
  });

  afterEach(() => {
    mocks.departmentsReady.mockResolvedValue(false);
  });

  const pin = (mode: "receive" | "dispense", extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    POST(new Request("http://test/api/mobile/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ mode, username: "user1", pin: "1234", batchItems: item, ...extra }),
    }));
  const line = () => post({ mode: "dispense", lineIdToken: "token", batchItems: item });
  const neverRuns = () => {
    expect(mocks.runReceiveBatch).not.toHaveBeenCalled();
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  };

  it("a) a resolver result without a scope still fails closed: 500 INTERNAL_ERROR, no username, nothing runs", async () => {
    mocks.resolveDepartmentForVerifiedUser.mockResolvedValue({ username: "secret.person", name: "Secret", role: "Manager" });

    for (const response of [await pin("receive"), await pin("dispense"), await line()]) {
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
      expect(text).not.toContain("secret.person");
    }
    neverRuns();
  });

  it("b) null (no usable department) answers 403 in Thai without the username, nothing runs, and the audit row names the verified user", async () => {
    mocks.resolveDepartmentForVerifiedUser.mockResolvedValue(null);

    for (const response of [await pin("receive"), await pin("dispense"), await line()]) {
      const text = await response.text();
      expect(response.status).toBe(403);
      expect(JSON.parse(text)).toEqual({ error: "บัญชีนี้ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ" });
      expect(text).not.toContain("user1");
    }
    neverRuns();
    expect(sqlValues()).toEqual(expect.arrayContaining(["user1", "Manager"]));
  });

  it("c) a department asked for in the header or the body is ignored: the resolver gets only the verified user", async () => {
    mocks.resolveDepartmentForVerifiedUser.mockResolvedValue(scopedUser({ scope: 1, departmentId: 1 }));

    const response = await pin("dispense", { departmentId: 2, scope: "ALL", department: "ALL" }, { "X-Department-Id": "2" });

    expect(response.status).toBe(200);
    expect(mocks.resolveDepartmentForVerifiedUser).toHaveBeenCalledTimes(1);
    expect(mocks.resolveDepartmentForVerifiedUser).toHaveBeenCalledWith(verifiedUser);
    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(item, expect.objectContaining({ username: "user1" }), expect.any(Object), { mode: "one", departmentId: 1 });
  });

  it("d) an Admin works in one department, never in mode all", async () => {
    mocks.verifyUserPin.mockResolvedValue({ username: "admin1", name: "Admin", role: "Admin", globalRole: "Admin" });
    mocks.resolveDepartmentForVerifiedUser.mockResolvedValue({ username: "admin1", name: "Admin", role: "Admin", globalRole: "Admin", scope: 1, departmentId: 1 });

    await pin("receive");
    await pin("dispense");

    expect(mocks.runReceiveBatch).toHaveBeenCalledWith(item, expect.anything(), expect.any(Object), { mode: "one", departmentId: 1 });
    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(item, expect.anything(), expect.any(Object), { mode: "one", departmentId: 1 });
  });

  it("e) flag off: the resolver is not called, the answer and the legacy scope are unchanged", async () => {
    mocks.departmentsReady.mockResolvedValue(false);

    const response = await pin("dispense");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, approver: { username: "user1", name: "User One", role: "Manager" } });
    expect(mocks.resolveDepartmentForVerifiedUser).not.toHaveBeenCalled();
    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(item, verifiedUser, expect.any(Object), { mode: "legacy" });
  });

  it("f) an unexpected resolver error is answered by the generic handler: no raw message, nothing runs", async () => {
    mocks.resolveDepartmentForVerifiedUser.mockRejectedValue(new Error("connection reset by peer 10.0.0.5"));

    const response = await pin("dispense");
    const text = await response.text();

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(text).not.toContain("connection reset");
    expect(text).not.toContain("10.0.0.5");
    neverRuns();
  });

  it("g) a missing department schema (42P01) marks departments not ready once and continues on the legacy path", async () => {
    mocks.resolveDepartmentForVerifiedUser.mockRejectedValue(Object.assign(new Error("relation user_departments does not exist"), { code: "42P01" }));

    const response = await pin("dispense");

    expect(response.status).toBe(200);
    expect(mocks.markDepartmentsNotReady).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ success: true, approver: { username: "user1", name: "User One", role: "Manager" } });
    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(item, verifiedUser, expect.any(Object), { mode: "legacy" });
  });

  it("h) the resolver gets the username from the verification, not the (differently cased) body", async () => {
    await pin("dispense", { username: "USER1" });

    expect(mocks.verifyUserPin).toHaveBeenCalledWith("USER1", "1234");
    expect(mocks.resolveDepartmentForVerifiedUser).toHaveBeenCalledWith(expect.objectContaining({ username: "user1" }));
  });

  it("i) a global Vendor is refused before the resolver; a Vendor role in the department is refused too", async () => {
    mocks.verifyUserPin.mockResolvedValue({ username: "v", name: "V", role: "Vendor", globalRole: "Vendor" });
    expect((await pin("dispense")).status).toBe(403);
    expect(mocks.resolveDepartmentForVerifiedUser).not.toHaveBeenCalled();

    mocks.verifyUserPin.mockResolvedValue(verifiedUser);
    mocks.resolveDepartmentForVerifiedUser.mockResolvedValue(scopedUser({ role: "Vendor" }));
    expect((await pin("dispense")).status).toBe(403);
    expect(mocks.roleHasMenu).not.toHaveBeenCalled();
    neverRuns();
  });

  it("j) the role of the department is used for the menu check and the approver (PIN and LINE)", async () => {
    const pinResponse = await pin("receive");
    expect(mocks.roleHasMenu).toHaveBeenLastCalledWith("Technician", "receive");
    expect((await pinResponse.json()).approver).toEqual({ username: "user1", name: "User One", role: "Technician" });

    const lineResponse = await line();
    expect(lineResponse.status).toBe(200);
    expect(mocks.roleHasMenu).toHaveBeenLastCalledWith("Technician", "dispense");
    expect((await lineResponse.json()).approver.role).toBe("Technician");
    expect(mocks.runDispenseBatch).toHaveBeenLastCalledWith(item, expect.anything(), expect.any(Object), { mode: "one", departmentId: 2 });
  });

  it("j2) a role without the menu in the department is refused with the existing 403", async () => {
    mocks.roleHasMenu.mockResolvedValue(false);
    const response = await pin("dispense");
    expect(response.status).toBe(403);
    expect(mocks.roleHasMenu).toHaveBeenCalledWith("Technician", "dispense");
    neverRuns();
  });
});
