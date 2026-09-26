import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findActiveUserByEmail: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth-service", () => ({ findActiveUserByEmail: mocks.findActiveUserByEmail }));
vi.mock("@/lib/db", () => ({ default: mocks.sql }));

import { POST } from "./route";

describe("Google token API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sql.mockResolvedValue([]);
  });

  it("returns 401 without a Google session email", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(mocks.findActiveUserByEmail).not.toHaveBeenCalled();
  });

  it("returns 403 and issues no token when no active user has that exact email", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "Admin@Example.com" } });
    mocks.findActiveUserByEmail.mockResolvedValue(null);

    expect((await POST()).status).toBe(403);
    expect(mocks.findActiveUserByEmail).toHaveBeenCalledWith("admin@example.com");
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("issues a token for the user matched by exact email", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "staff@example.com" } });
    mocks.findActiveUserByEmail.mockResolvedValue({ username: "staff01", name: "Staff", role: "Operator", vendor: null });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user).toEqual({ username: "staff01", name: "Staff", role: "Operator", vendor: "" });
    expect(typeof body.token).toBe("string");
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });
});
