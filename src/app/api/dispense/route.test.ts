import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasMenuPermission: vi.fn(),
  runDispenseBatch: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({ hasMenuPermission: mocks.hasMenuPermission }));
vi.mock("@/lib/stock-transactions", () => ({ runDispenseBatch: mocks.runDispenseBatch }));

import { POST } from "./route";

function dispenseRequest() {
  return new Request("http://localhost/api/dispense", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchItems: [{ itemId: "CHEM-R-001", lotNo: "L1", qty: 1, inventoryId: 1 }] }),
  });
}

describe("Dispense API permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no authenticated user exists", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: null, allowed: false });
    expect((await POST(dispenseRequest())).status).toBe(401);
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });

  it("returns 403 for a role without the dispense menu", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { username: "vendor", role: "Vendor" }, allowed: false });
    expect((await POST(dispenseRequest())).status).toBe(403);
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });

  it("dispenses stock for a role with the dispense menu", async () => {
    const user = { username: "staff", name: "Staff", role: "Operator" };
    mocks.hasMenuPermission.mockResolvedValue({ user, allowed: true });
    mocks.runDispenseBatch.mockResolvedValue({ success: true });

    const response = await POST(dispenseRequest());

    expect(response.status).toBe(200);
    expect(mocks.hasMenuPermission).toHaveBeenCalledWith(expect.any(Request), "dispense");
    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(expect.any(Array), user, expect.any(Object));
  });
});
