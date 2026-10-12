import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("POST /api/mobile/confirm PIN attempt limiting", () => {
  const sqlText = (strings: TemplateStringsArray) => strings.join("?");
  let attempts: { count: number | Error; insertId: number | Error };

  beforeEach(() => {
    vi.clearAllMocks();
    attempts = { count: 1, insertId: 7 };
    mocks.sql.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = sqlText(strings);
      if (text.includes("'/api/mobile/confirm'")) {
        if (attempts.insertId instanceof Error) throw attempts.insertId;
        return [{ id: attempts.insertId }];
      }
      if (text.includes("COUNT(*)")) {
        if (attempts.count instanceof Error) throw attempts.count;
        return [{ n: attempts.count }];
      }
      return [];
    });
    mocks.hasUserPinColumn.mockResolvedValue(true);
    mocks.hasUserLineIdColumn.mockResolvedValue(true);
    mocks.roleHasMenu.mockResolvedValue(true);
    mocks.runDispenseBatch.mockResolvedValue({ success: true });
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([]);
    vi.restoreAllMocks();
  });

  const pinPost = () => post({ mode: "dispense", username: "mt", pin: "1234", batchItems: item });
  const updateCalls = () => mocks.sql.mock.calls.filter(([strings]) => sqlText(strings as TemplateStringsArray).includes("UPDATE app_events"));

  it("still succeeds when the attempt tracking queries throw (fail-open)", async () => {
    attempts = { count: new Error("db down"), insertId: new Error("db down") };
    const response = await pinPost();
    expect(response.status).toBe(200);
    expect(mocks.verifyUserPin).toHaveBeenCalledTimes(1);
  });

  it("still succeeds when sql returns no rows", async () => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([]);
    const response = await pinPost();
    expect(response.status).toBe(200);
    expect(mocks.verifyUserPin).toHaveBeenCalledTimes(1);
  });

  it("allows the 5th attempt in the window", async () => {
    attempts.count = 5;
    const response = await pinPost();
    expect(response.status).toBe(200);
    expect(mocks.verifyUserPin).toHaveBeenCalledTimes(1);
  });

  it("blocks the 6th attempt with 429 RATE_LIMITED without checking the PIN", async () => {
    attempts.count = 6;
    const response = await pinPost();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "ใส่ PIN ผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่", code: "RATE_LIMITED" });
    expect(mocks.verifyUserPin).not.toHaveBeenCalled();
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
    expect(updateCalls()).toHaveLength(0);
  });

  it("never records or counts attempts on the LINE (LIFF) path", async () => {
    mocks.verifyLineIdToken.mockResolvedValue({ sub: "U1" });
    mocks.getLineLinkedUser.mockResolvedValue({ username: "u", name: "U", role: "User" });
    attempts.count = 99;
    const response = await post({ mode: "dispense", lineIdToken: "token", batchItems: item });
    expect(response.status).toBe(200);
    const texts = mocks.sql.mock.calls.map(([strings]) => sqlText(strings as TemplateStringsArray));
    expect(texts.some((text) => text.includes("COUNT(*)") || text.includes("'/api/mobile/confirm'"))).toBe(false);
  });

  it("leaves the attempt counted after a wrong PIN", async () => {
    mocks.verifyUserPin.mockResolvedValue(null);
    const response = await pinPost();
    expect(response.status).toBe(401);
    expect(updateCalls()).toHaveLength(0);
  });

  it("marks the attempt as success after the correct PIN", async () => {
    const response = await pinPost();
    expect(response.status).toBe(200);
    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0].slice(1)).toEqual([7]);
  });
});
