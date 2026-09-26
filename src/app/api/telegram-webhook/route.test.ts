import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendTelegramMessage: vi.fn(),
  getTelegramAllowedChatIds: vi.fn(() => [] as string[]),
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
  getLowStockRows: vi.fn(),
  getRecentLogRows: vi.fn(),
  searchStockRows: vi.fn(),
}));

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
