import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([]),
  hasUserPinColumn: vi.fn(),
  verifyUserPin: vi.fn(),
  roleHasMenu: vi.fn(),
  verifyLineIdToken: vi.fn(),
  getLineLinkedUser: vi.fn(),
  hasUserLineIdColumn: vi.fn(),
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
vi.mock("@/lib/stock-transactions", () => ({
  runReceiveBatch: mocks.runReceiveBatch,
  runDispenseBatch: mocks.runDispenseBatch,
}));

import { AppError } from "@/lib/errors";
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
