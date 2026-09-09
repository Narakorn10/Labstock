import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getPurchaseOrderSuggestions: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/purchase-order-suggestions", () => ({ getPurchaseOrderSuggestions: mocks.getPurchaseOrderSuggestions }));
vi.mock("@/lib/purchase-order-workflow", () => ({ isLabPurchasingRole: (role: string) => role === "Admin" || role === "Manager" }));
vi.mock("@/lib/purchase-order-ai-review", () => ({
  aiReviewerResponseSchema: {}, buildAiReviewerPayload: vi.fn(), fingerprintAiReviewerPayload: vi.fn(), parseAiReviews: vi.fn(),
}));
vi.mock("@google/genai", () => ({ GoogleGenAI: vi.fn() }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/purchase-orders/ai-review", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("purchase-order AI reviewer access gate", () => {
  const priorKey = process.env.GEMINI_API_KEY;
  const priorModel = process.env.GEMINI_MODEL;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });
  afterEach(() => {
    if (priorKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = priorKey;
    if (priorModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = priorModel;
  });

  it("rejects anonymous, Lab, and Vendor callers before any AI/database use", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);
    expect((await POST(request({ vendor: "V" }))).status).toBe(401);
    mocks.getAuthenticatedUser.mockResolvedValueOnce({ username: "lab", role: "User" });
    expect((await POST(request({ vendor: "V" }))).status).toBe(403);
    mocks.getAuthenticatedUser.mockResolvedValueOnce({ username: "vendor", role: "Vendor" });
    expect((await POST(request({ vendor: "V" }))).status).toBe(403);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("keeps formula-based ordering available when AI is not configured", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "manager", role: "Manager" });
    const response = await POST(request({ vendor: "V" }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("AI_UNAVAILABLE");
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.getPurchaseOrderSuggestions).not.toHaveBeenCalled();
  });
});
