import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getPurchaseOrderSuggestions: vi.fn(),
  buildAiReviewerPayload: vi.fn(),
  fingerprintAiReviewerPayload: vi.fn(),
  parseAiReviews: vi.fn(),
  generateContent: vi.fn(),
  getDepartmentScope: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/scoped-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scoped-db")>()),
  getDepartmentScope: mocks.getDepartmentScope,
}));
vi.mock("@/lib/purchase-order-suggestions", () => ({ getPurchaseOrderSuggestions: mocks.getPurchaseOrderSuggestions }));
vi.mock("@/lib/purchase-order-workflow", () => ({ isLabPurchasingRole: (role: string) => role === "Admin" || role === "Manager" }));
vi.mock("@/lib/purchase-order-ai-review", () => ({
  aiReviewerResponseSchema: {},
  buildAiReviewerPayload: mocks.buildAiReviewerPayload,
  fingerprintAiReviewerPayload: mocks.fingerprintAiReviewerPayload,
  parseAiReviews: mocks.parseAiReviews,
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));

import { POST } from "./route";
import { DepartmentScopeError } from "@/lib/scoped-db";

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
    mocks.getDepartmentScope.mockResolvedValue({ mode: "legacy" });
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });
  afterEach(() => {
    vi.useRealTimers();
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

  it("reports a clear message when Gemini exceeds the 60-second limit", async () => {
    vi.useFakeTimers();
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-test";
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "manager", role: "Manager" });
    mocks.fingerprintAiReviewerPayload.mockReturnValue("a".repeat(64));
    mocks.getPurchaseOrderSuggestions.mockResolvedValue([]);
    mocks.buildAiReviewerPayload.mockReturnValue([]);
    mocks.sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([]);
    mocks.generateContent.mockReturnValue(new Promise(() => undefined));

    const responsePromise = POST(request({ vendor: "Vendor" }));
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await responsePromise;

    expect(mocks.getPurchaseOrderSuggestions).toHaveBeenCalledWith(mocks.sql, { vendor: "Vendor" }, { mode: "legacy" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AI ใช้เวลาวิเคราะห์นานเกิน 60 วินาที กรุณาลองใหม่อีกครั้ง",
      code: "AI_UNAVAILABLE",
    });
  });

  it("returns the department error before reading the body, rate-limiting or loading suggestions", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-test";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "manager", role: "Manager" });
    mocks.getDepartmentScope.mockRejectedValue(new DepartmentScopeError("DEPARTMENT_NOT_FOUND", "no such department"));

    const response = await POST(request({ vendor: "V" }));

    expect(response.status).toBe(404);
    expect(mocks.getPurchaseOrderSuggestions).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled(); // no rate-limit SELECT/INSERT
  });
});
