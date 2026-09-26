import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasMenuPermission: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ hasMenuPermission: mocks.hasMenuPermission }));

import { GET } from "./route";

const logsRequest = () => new Request("http://localhost/api/logs?limit=10");

describe("Logs API permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no authenticated user exists", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: null, allowed: false });
    expect((await GET(logsRequest())).status).toBe(401);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("returns 403 for a role without the logs menu", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { username: "vendor", role: "Vendor" }, allowed: false });
    expect((await GET(logsRequest())).status).toBe(403);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("returns logs for a role with the logs menu", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { username: "staff", role: "Operator" }, allowed: true });
    mocks.sql.mockResolvedValue([{ id: 1 }]);

    const response = await GET(logsRequest());

    expect(response.status).toBe(200);
    expect(mocks.hasMenuPermission).toHaveBeenCalledWith(expect.any(Request), "logs");
    expect(await response.json()).toEqual([{ id: 1 }]);
  });
});
