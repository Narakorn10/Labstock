import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([]),
  getAuthenticatedUser: vi.fn(),
  confirmCountWorkOrder: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/count-work-orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/count-work-orders")>()),
  confirmCountWorkOrder: mocks.confirmCountWorkOrder,
}));

import { CountConfirmError } from "@/lib/count-work-orders";
import { POST } from "./route";

const routeContext = { params: Promise.resolve({ id: "7" }) };

function confirmRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/count-work-orders/7/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ allocations: [{ itemId: "R1", inventoryId: 1, qty: 2 }] }),
  });
}

describe("Count confirm API error responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "staff", role: "Operator" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns 401 AUTH_REQUIRED when not signed in", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const response = await POST(confirmRequest(), routeContext);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("AUTH_REQUIRED");
  });

  it("keeps failed and remaining at the top level of a 409", async () => {
    const failed = [{ itemId: "R1", reason: "x" }];
    const remaining = [{ itemId: "R2" }];
    mocks.confirmCountWorkOrder.mockRejectedValue(new CountConfirmError("ไม่มีรายการที่เบิกได้", failed as never, remaining as never));
    const response = await POST(confirmRequest(), routeContext);
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "COUNT_NOTHING_TO_DISPENSE", failed, remaining });
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("hides raw database errors behind a 500", async () => {
    mocks.confirmCountWorkOrder.mockRejectedValue(new Error("relation x does not exist"));
    const response = await POST(confirmRequest({ "x-request-id": "req-1" }), routeContext);
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("relation");
    expect(JSON.parse(text)).toMatchObject({ code: "INTERNAL_ERROR", requestId: "req-1" });
  });
});
