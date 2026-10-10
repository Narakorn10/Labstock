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
vi.mock("@/lib/departments-flag", () => ({ departmentsReady: mocks.departmentsReady }));
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

// TEMPORARY: replaced by the resolveDepartmentForVerifiedUser tests when the feat/departments-mobile-auth PR (step 8b) merges.
// Until then a verified PIN/LINE user never carries a department scope, so with departments ON the mobile path must refuse
// (fail closed) instead of silently showing or writing every department.
describe("POST /api/mobile/confirm fail-closed when departments are on but the approver has no scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.hasUserPinColumn.mockResolvedValue(true);
    mocks.hasUserLineIdColumn.mockResolvedValue(true);
    mocks.roleHasMenu.mockResolvedValue(true);
    mocks.departmentsReady.mockResolvedValue(true);
  });

  afterEach(() => {
    mocks.departmentsReady.mockResolvedValue(false);
  });

  it.each(["receive", "dispense"] as const)("PIN %s answers 500 INTERNAL_ERROR without the username and never runs", async (mode) => {
    mocks.verifyUserPin.mockResolvedValue({ username: "secret.person", name: "Secret", role: "Manager" });

    const response = await post({ mode, username: "secret.person", pin: "1234", batchItems: item });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("secret.person");
    expect(mocks.runReceiveBatch).not.toHaveBeenCalled();
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });

  it("LINE dispense answers 500 INTERNAL_ERROR without the username and never runs", async () => {
    mocks.verifyLineIdToken.mockResolvedValue({ sub: "U1" });
    mocks.getLineLinkedUser.mockResolvedValue({ username: "secret.person", name: "Secret", role: "Manager" });

    const response = await post({ mode: "dispense", lineIdToken: "token", batchItems: item });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("secret.person");
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });
});
