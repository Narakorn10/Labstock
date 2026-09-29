import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([]),
  hasMenuPermission: vi.fn(),
  runReceiveBatch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ hasMenuPermission: mocks.hasMenuPermission }));
vi.mock("@/lib/stock-transactions", () => ({ runReceiveBatch: mocks.runReceiveBatch }));

import { POST } from "./route";

function receiveRequest() {
  return new Request("http://localhost/api/receive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchItems: [{ itemId: "CHEM-R-001", lotNo: "L1", qty: 1 }] }),
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
