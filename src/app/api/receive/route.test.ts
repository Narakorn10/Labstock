import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([]),
  hasMenuPermission: vi.fn(),
  runReceiveBatch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ hasMenuPermission: mocks.hasMenuPermission }));
vi.mock("@/lib/stock-transactions", () => ({ runReceiveBatch: mocks.runReceiveBatch }));

import { AppError } from "@/lib/errors";
import { POST } from "./route";

function receiveRequest(init: { headers?: Record<string, string>; body?: string } = {}) {
  return new Request("http://localhost/api/receive", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...init.headers },
    body: init.body ?? JSON.stringify({ batchItems: [{ itemId: "CHEM-R-001", lotNo: "L1", qty: 1 }] }),
  });
}

describe("Receive API permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no authenticated user exists", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: null, allowed: false });
    expect((await POST(receiveRequest())).status).toBe(401);
    expect(mocks.runReceiveBatch).not.toHaveBeenCalled();
  });

  it("returns 403 for a role without the receive menu", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { username: "vendor", role: "Vendor" }, allowed: false });
    expect((await POST(receiveRequest())).status).toBe(403);
    expect(mocks.runReceiveBatch).not.toHaveBeenCalled();
  });

  it("receives stock for a role with the receive menu", async () => {
    const user = { username: "staff", name: "Staff", role: "Operator" };
    mocks.hasMenuPermission.mockResolvedValue({ user, allowed: true });
    mocks.runReceiveBatch.mockResolvedValue({ success: true });

    const response = await POST(receiveRequest());

    expect(response.status).toBe(200);
    expect(mocks.hasMenuPermission).toHaveBeenCalledWith(expect.any(Request), "receive");
    expect(mocks.runReceiveBatch).toHaveBeenCalledWith(expect.any(Array), user, expect.any(Object));
  });
});

describe("receive API error responses", () => {
  const user = { username: "staff", name: "Staff", role: "Operator" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasMenuPermission.mockResolvedValue({ user, allowed: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("401 uses the catalogue body", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: null, allowed: false });
    const response = await POST(receiveRequest());
    const body = await response.json();
    expect(body).toMatchObject({ code: "AUTH_REQUIRED", error: "กรุณาเข้าสู่ระบบก่อนใช้งาน" });
    expect(body.hint).toEqual(expect.any(String));
  });

  it("maps REAGENT_INACTIVE to 409", async () => {
    mocks.runReceiveBatch.mockRejectedValue(new AppError("REAGENT_INACTIVE", { detail: "REAGENT_INACTIVE: R1" }));
    const response = await POST(receiveRequest());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("REAGENT_INACTIVE");
  });

  it("returns 400 VALIDATION_FAILED when batchItems is missing or empty", async () => {
    for (const body of [{}, { batchItems: [] }, { batchItems: "x" }]) {
      const response = await POST(receiveRequest({ body: JSON.stringify(body) }));
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_FAILED");
    }
    expect(mocks.runReceiveBatch).not.toHaveBeenCalled();
  });

  it("hides raw database errors behind a 500 INTERNAL_ERROR", async () => {
    mocks.runReceiveBatch.mockRejectedValue(new Error("relation x does not exist"));
    const response = await POST(receiveRequest());
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("relation");
  });

  it("returns 400 INVALID_JSON for an unreadable body", async () => {
    const response = await POST(receiveRequest({ body: "{not json" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_JSON");
  });

  it("puts the same requestId in the body and the x-request-id header", async () => {
    mocks.runReceiveBatch.mockRejectedValue(new Error("boom"));
    const response = await POST(receiveRequest());
    const body = await response.json();
    expect(body.requestId).toBeTruthy();
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("echoes an incoming x-request-id", async () => {
    mocks.runReceiveBatch.mockRejectedValue(new Error("boom"));
    const response = await POST(receiveRequest({ headers: { "x-request-id": "req-abc-123" } }));
    expect(response.headers.get("x-request-id")).toBe("req-abc-123");
    expect((await response.json()).requestId).toBe("req-abc-123");
  });
});
