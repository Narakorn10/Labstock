import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getReagentItemUsage: vi.fn(),
  departmentsReady: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/reagent-item-usage", () => ({ getReagentItemUsage: mocks.getReagentItemUsage }));
vi.mock("@/lib/departments-flag", () => ({ departmentsReady: mocks.departmentsReady }));

import { GET } from "./route";

const URL_OK = "http://localhost/api/usage/item?itemId=R1&startDate=2026-09-01&endDate=2026-09-30";
const manager = { username: "mgr", name: "Manager", role: "Manager" };
const detail = { item: { itemId: "R1" }, daily: [] };

const get = (url = URL_OK) => GET(new Request(url));

describe("GET /api/usage/item", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.departmentsReady.mockResolvedValue(false);
  });

  it("returns 401 when there is no user", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(mocks.getReagentItemUsage).not.toHaveBeenCalled();
  });

  it("returns 403 for a role that is not Admin or Manager and never calls the lib", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "u", role: "User" });
    expect((await get()).status).toBe(403);
    expect(mocks.getReagentItemUsage).not.toHaveBeenCalled();
  });

  it("calls the lib with { mode: \"legacy\" } when departments are off and returns the JSON unchanged", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(manager);
    mocks.getReagentItemUsage.mockResolvedValue(detail);

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(mocks.getReagentItemUsage).toHaveBeenCalledWith("R1", "2026-09-01", "2026-09-30", { mode: "legacy" });
  });

  it("passes { mode: \"one\", departmentId } for a user with a department scope", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...manager, scope: 2 });
    mocks.getReagentItemUsage.mockResolvedValue(detail);

    expect((await get()).status).toBe(200);
    expect(mocks.getReagentItemUsage).toHaveBeenCalledWith("R1", "2026-09-01", "2026-09-30", { mode: "one", departmentId: 2 });
  });

  it("returns 404 Item not found when the lib returns null", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(manager);
    mocks.getReagentItemUsage.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Item not found" });
  });

  it("returns 400 for a missing itemId or a bad date range", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(manager);
    expect((await get("http://localhost/api/usage/item?startDate=2026-09-01&endDate=2026-09-30")).status).toBe(400);
    expect((await get("http://localhost/api/usage/item?itemId=R1&startDate=2026-09-30&endDate=2026-09-01")).status).toBe(400);
    expect(mocks.getReagentItemUsage).not.toHaveBeenCalled();
  });

  it("answers the department catalogue response (404 DEPARTMENT_NOT_FOUND) instead of 500", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...manager, scope: 2, departmentDenied: true });

    const response = await get();

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("DEPARTMENT_NOT_FOUND");
    expect(mocks.getReagentItemUsage).not.toHaveBeenCalled();
  });

  it("keeps the existing 500 with the raw message for a generic error", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(manager);
    mocks.getReagentItemUsage.mockRejectedValue(new Error("boom"));

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "boom" });
  });
});
