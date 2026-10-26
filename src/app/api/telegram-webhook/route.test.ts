import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendTelegramMessage: vi.fn(),
  getTelegramAllowedChatIds: vi.fn(() => [] as string[]),
  getLowStockRows: vi.fn().mockResolvedValue([]),
  getRecentLogRows: vi.fn().mockResolvedValue([]),
  searchStockRows: vi.fn().mockResolvedValue([]),
  departmentsReady: vi.fn(async () => false),
  defaultRoomId: vi.fn(async () => 1 as number | null),
}));

vi.mock("@/lib/telegram-bot", () => ({
  buildTelegramHelpText: vi.fn(() => "help"),
  buildTelegramRouteMessage: vi.fn(() => "route"),
  formatRecentLogsTelegramDigest: vi.fn(() => "logs"),
  formatStockTelegramDigest: vi.fn(() => "stock"),
  getTelegramAllowedChatIds: mocks.getTelegramAllowedChatIds,
  sendTelegramMessage: mocks.sendTelegramMessage,
}));
vi.mock("@/lib/bot-stock-queries", () => ({
  getLowStockRows: mocks.getLowStockRows,
  getRecentLogRows: mocks.getRecentLogRows,
  searchStockRows: mocks.searchStockRows,
}));
// scoped-db (DepartmentScopeError) pulls in the database client; any query reaching it fails the test.
vi.mock("@/lib/db", () => ({
  default: Object.assign(() => { throw new Error("unexpected SQL in the Telegram route test"); }, { unsafe: () => { throw new Error("unexpected SQL"); } }),
}));
vi.mock("@/lib/departments-flag", () => ({ departmentsReady: mocks.departmentsReady }));
vi.mock("@/lib/user-rooms", () => ({ defaultRoomId: mocks.defaultRoomId }));

// The route reads TELEGRAM_WEBHOOK_SECRET when the module loads, so each test
// sets the env first and then imports a fresh copy of the route.
async function loadRoute(secret: string) {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", secret);
  vi.resetModules();
  return import("./route");
}

function webhookRequest(secretHeader?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secretHeader !== undefined) headers["x-telegram-bot-api-secret-token"] = secretHeader;
  return new Request("http://localhost/api/telegram-webhook", {
    method: "POST",
    headers,
    body: JSON.stringify({ message: { text: "/help", chat: { id: 123 } } }),
  });
}

describe("Telegram webhook secret check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects every request with 503 when no secret is configured", async () => {
    const { POST } = await loadRoute("");
    expect((await POST(webhookRequest())).status).toBe(503);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("returns 401 when the secret header is wrong", async () => {
    const { POST } = await loadRoute("expected-secret");
    expect((await POST(webhookRequest("wrong"))).status).toBe(401);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("accepts a request with the correct secret header", async () => {
    const { POST } = await loadRoute("expected-secret");
    expect((await POST(webhookRequest("expected-secret"))).status).toBe(200);
  });
});

function commandRequest(text: string) {
  return new Request("http://localhost/api/telegram-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "expected-secret" },
    body: JSON.stringify({ message: { text, chat: { id: 123 } } }),
  });
}

const SAFE_TEXT = "ยังใช้คำสั่งนี้ไม่ได้ กรุณาแจ้งผู้ดูแลระบบ";
const readCalls = () => [mocks.getLowStockRows, mocks.getRecentLogRows, mocks.searchStockRows].flatMap((fn) => fn.mock.calls);

// Owner policy: Telegram answers for the default room CC only (never "all"); departments off => legacy.
describe("Telegram webhook department scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTelegramAllowedChatIds.mockReturnValue(["123"]);
    mocks.departmentsReady.mockResolvedValue(false);
    mocks.defaultRoomId.mockResolvedValue(1);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("switch off: all three commands pass { mode: legacy } and never look up the CC room", async () => {
    const { POST } = await loadRoute("expected-secret");
    for (const text of ["/stock", "/stock abc", "/logs 5"]) expect((await POST(commandRequest(text))).status).toBe(200);
    expect(mocks.getLowStockRows).toHaveBeenCalledWith(10, { mode: "legacy" });
    expect(mocks.searchStockRows).toHaveBeenCalledWith("abc", 10, { mode: "legacy" });
    expect(mocks.getRecentLogRows).toHaveBeenCalledWith(5, { mode: "legacy" });
    expect(mocks.defaultRoomId).not.toHaveBeenCalled();
  });

  it("switch on with CC: all three commands pass { mode: one, departmentId: <CC> }", async () => {
    mocks.departmentsReady.mockResolvedValue(true);
    mocks.defaultRoomId.mockResolvedValue(7);
    const { POST } = await loadRoute("expected-secret");
    for (const text of ["/stock", "/stock abc", "/transactions 3"]) expect((await POST(commandRequest(text))).status).toBe(200);
    const one = { mode: "one", departmentId: 7 };
    expect(mocks.getLowStockRows).toHaveBeenCalledWith(10, one);
    expect(mocks.searchStockRows).toHaveBeenCalledWith("abc", 10, one);
    expect(mocks.getRecentLogRows).toHaveBeenCalledWith(3, one);
    expect(readCalls().every((call) => (call.at(-1) as { mode: string }).mode === "one")).toBe(true);
  });

  it("switch on but CC missing or inactive: safe Thai message, no data read", async () => {
    mocks.departmentsReady.mockResolvedValue(true);
    mocks.defaultRoomId.mockResolvedValue(null);
    const { POST } = await loadRoute("expected-secret");
    for (const text of ["/stock", "/stock abc", "/logs"]) expect((await POST(commandRequest(text))).status).toBe(200);
    expect(readCalls()).toHaveLength(0);
    expect(mocks.sendTelegramMessage.mock.calls).toEqual([["123", SAFE_TEXT], ["123", SAFE_TEXT], ["123", SAFE_TEXT]]);
  });

  it("switch on but the CC lookup throws: safe message, no data read, nothing internal leaks", async () => {
    mocks.departmentsReady.mockResolvedValue(true);
    mocks.defaultRoomId.mockRejectedValue(new Error("connection failed for user alice"));
    const { POST } = await loadRoute("expected-secret");
    const response = await POST(commandRequest("/stock"));
    expect(response.status).toBe(200);
    expect(readCalls()).toHaveLength(0);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith("123", SAFE_TEXT);
    // JSON.stringify(new Error(...)) gives "{}" (message is not enumerable), so turn every logged argument into text first.
    const asText = (value: unknown) => (value instanceof Error ? `${value.name} ${value.message} ${value.stack}` : String(value));
    const logged = vi.mocked(console.error).mock.calls.flat().map(asText).join(" ");
    expect(logged).toContain("could not resolve the department scope");
    expect(logged).not.toContain("alice");
    const out = JSON.stringify([await response.text(), mocks.sendTelegramMessage.mock.calls]);
    expect(out).not.toContain("alice");
  });

  it("switch on, chat not in the allow-list: refused without touching the switch, the CC lookup or any data", async () => {
    mocks.departmentsReady.mockResolvedValue(true);
    const { POST } = await loadRoute("expected-secret");
    const request = new Request("http://localhost/api/telegram-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "expected-secret" },
      body: JSON.stringify({ message: { text: "/stock", chat: { id: 999 } } }),
    });
    expect((await POST(request)).status).toBe(200);
    expect(mocks.departmentsReady).not.toHaveBeenCalled();
    expect(mocks.defaultRoomId).not.toHaveBeenCalled();
    expect(readCalls()).toHaveLength(0);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage.mock.calls[0][0]).toBe("999");
    expect(mocks.sendTelegramMessage.mock.calls[0][1]).not.toBe(SAFE_TEXT);
  });

  it("switch on, /help from an allowed chat: no department check, no CC lookup, no data read", async () => {
    mocks.departmentsReady.mockResolvedValue(true);
    const { POST } = await loadRoute("expected-secret");
    expect((await POST(commandRequest("/help"))).status).toBe(200);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith("123", "help");
    expect(mocks.departmentsReady).not.toHaveBeenCalled();
    expect(mocks.defaultRoomId).not.toHaveBeenCalled();
    expect(readCalls()).toHaveLength(0);
  });
});
