import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([]),
  verifyUserPin: vi.fn(),
  verifyLineIdToken: vi.fn(),
  getLineLinkedUser: vi.fn(),
  hasUserLineIdColumn: vi.fn(),
  linkLineRichMenuForRole: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ verifyUserPin: mocks.verifyUserPin }));
vi.mock("@/lib/line-liff-auth", () => ({
  verifyLineIdToken: mocks.verifyLineIdToken,
  getLineLinkedUser: mocks.getLineLinkedUser,
  hasUserLineIdColumn: mocks.hasUserLineIdColumn,
}));
vi.mock("@/lib/line-bot", () => ({ linkLineRichMenuForRole: mocks.linkLineRichMenuForRole }));

import { POST } from "./route";

const sqlText = (strings: TemplateStringsArray) => strings.join("?");
const post = (body: Record<string, unknown>) =>
  POST(new Request("http://test/api/mobile/line-link", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/mobile/line-link PIN attempt limiting", () => {
  let attempts: { count: number | Error; insertId: number | Error };

  beforeEach(() => {
    vi.clearAllMocks();
    attempts = { count: 1, insertId: 7 };
    mocks.sql.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = sqlText(strings);
      if (text.includes("INSERT INTO app_events")) {
        if (attempts.insertId instanceof Error) throw attempts.insertId;
        return [{ id: attempts.insertId }];
      }
      if (text.includes("COUNT(*)")) {
        if (attempts.count instanceof Error) throw attempts.count;
        return [{ n: attempts.count }];
      }
      return [];
    });
    mocks.verifyLineIdToken.mockResolvedValue({ sub: "U1" });
    mocks.hasUserLineIdColumn.mockResolvedValue(true);
    mocks.getLineLinkedUser.mockResolvedValue(null);
    mocks.verifyUserPin.mockResolvedValue({ username: "mt", name: "MT", role: "Manager" });
    mocks.linkLineRichMenuForRole.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([]);
    vi.restoreAllMocks();
  });

  const linkPost = () => post({ idToken: "token", username: "mt", pin: "1234" });
  const callsWith = (needle: string) =>
    mocks.sql.mock.calls.filter(([strings]) => sqlText(strings as TemplateStringsArray).includes(needle));
  const updateAttemptCalls = () => callsWith("UPDATE app_events");
  const updateUserCalls = () => callsWith("UPDATE users");

  it("allows the 5th attempt in the window and links the account", async () => {
    attempts.count = 5;
    const response = await linkPost();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ linked: true });
    expect(mocks.verifyUserPin).toHaveBeenCalledTimes(1);
    expect(updateUserCalls()).toHaveLength(1);
    expect(mocks.linkLineRichMenuForRole).toHaveBeenCalledWith("U1", "Manager");
  });

  it("blocks the 6th attempt with 429 RATE_LIMITED without checking the PIN or linking", async () => {
    attempts.count = 6;
    const response = await linkPost();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "ใส่ PIN ผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่", code: "RATE_LIMITED" });
    expect(mocks.verifyUserPin).not.toHaveBeenCalled();
    expect(updateUserCalls()).toHaveLength(0);
    expect(mocks.linkLineRichMenuForRole).not.toHaveBeenCalled();
  });

  it("leaves the attempt counted after a wrong PIN", async () => {
    mocks.verifyUserPin.mockResolvedValue(null);
    const response = await linkPost();
    expect(response.status).toBe(401);
    expect(updateAttemptCalls()).toHaveLength(0);
    expect(updateUserCalls()).toHaveLength(0);
  });

  it("marks exactly the inserted attempt as success after the correct PIN", async () => {
    const response = await linkPost();
    expect(response.status).toBe(200);
    expect(updateAttemptCalls()).toHaveLength(1);
    expect(updateAttemptCalls()[0].slice(1)).toEqual([7]);
  });

  it("marks the attempt as success for a Vendor with the correct PIN, then refuses with 403", async () => {
    mocks.verifyUserPin.mockResolvedValue({ username: "v", name: "V", role: "Vendor" });
    const response = await linkPost();
    expect(response.status).toBe(403);
    expect(updateAttemptCalls()).toHaveLength(1);
    expect(updateUserCalls()).toHaveLength(0);
    expect(mocks.linkLineRichMenuForRole).not.toHaveBeenCalled();
  });

  it("records the attempt with source line-link", async () => {
    await linkPost();
    const insert = callsWith("INSERT INTO app_events");
    expect(insert).toHaveLength(1);
    const values = insert[0].slice(1) as unknown[];
    expect(values.some((value) => typeof value === "string" && value.includes('"source":"line-link"'))).toBe(true);
  });

  it("neither records nor counts when the LINE token is invalid", async () => {
    mocks.verifyLineIdToken.mockResolvedValue(null);
    const response = await linkPost();
    expect(response.status).toBe(401);
    expect(callsWith("INSERT INTO app_events")).toHaveLength(0);
    expect(callsWith("COUNT(*)")).toHaveLength(0);
  });

  it("neither records nor counts when the LINE column is missing", async () => {
    mocks.hasUserLineIdColumn.mockResolvedValue(false);
    const response = await linkPost();
    expect(response.status).toBe(400);
    expect(callsWith("INSERT INTO app_events")).toHaveLength(0);
    expect(callsWith("COUNT(*)")).toHaveLength(0);
  });

  it("neither records nor counts when the LINE account is already linked", async () => {
    mocks.getLineLinkedUser.mockResolvedValue({ username: "u", name: "U", role: "User" });
    const response = await linkPost();
    expect(response.status).toBe(409);
    expect(callsWith("INSERT INTO app_events")).toHaveLength(0);
    expect(callsWith("COUNT(*)")).toHaveLength(0);
  });

  it.each([
    ["username", { idToken: "token", username: "  ", pin: "1234" }],
    ["pin", { idToken: "token", username: "mt", pin: "" }],
  ])("returns 400 and records nothing when %s is empty", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Username and PIN are required." });
    expect(callsWith("INSERT INTO app_events")).toHaveLength(0);
    expect(mocks.verifyUserPin).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when recording the attempt throws", async () => {
    attempts.insertId = new Error("db down");
    const response = await linkPost();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ระบบตรวจ PIN ไม่พร้อม กรุณาลองใหม่ภายหลัง" });
    expect(mocks.verifyUserPin).not.toHaveBeenCalled();
    expect(updateUserCalls()).toHaveLength(0);
  });

  it("fails closed with 503 when counting attempts throws", async () => {
    attempts.count = new Error("db down");
    const response = await linkPost();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ระบบตรวจ PIN ไม่พร้อม กรุณาลองใหม่ภายหลัง" });
    expect(mocks.verifyUserPin).not.toHaveBeenCalled();
    expect(updateUserCalls()).toHaveLength(0);
  });
});
