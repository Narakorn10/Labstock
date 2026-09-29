import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasMenuPermission: vi.fn(),
  listAppEvents: vi.fn(),
  getRepeatedFailures: vi.fn(),
  purgeOldAppEvents: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({ hasMenuPermission: mocks.hasMenuPermission }));
vi.mock("@/lib/app-events-query", () => ({
  listAppEvents: mocks.listAppEvents,
  getRepeatedFailures: mocks.getRepeatedFailures,
  purgeOldAppEvents: mocks.purgeOldAppEvents,
}));

import { GET } from "./route";

const get = (query = "") => GET(new Request(`http://localhost/api/app-events${query}`));

describe("GET /api/app-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasMenuPermission.mockResolvedValue({ user: { username: "admin", role: "Admin" }, allowed: true });
    mocks.listAppEvents.mockResolvedValue({ items: [], nextCursor: null });
    mocks.getRepeatedFailures.mockResolvedValue([]);
    mocks.purgeOldAppEvents.mockResolvedValue(0);
  });

  it("rejects anonymous callers", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: null, allowed: false });
    expect((await get()).status).toBe(401);
    expect(mocks.listAppEvents).not.toHaveBeenCalled();
  });

  it("rejects roles without the activity menu", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { username: "u", role: "User" }, allowed: false });
    expect((await get()).status).toBe(403);
    expect(mocks.listAppEvents).not.toHaveBeenCalled();
    expect(mocks.purgeOldAppEvents).not.toHaveBeenCalled();
  });

  it("checks the 'activity' menu permission", async () => {
    await get();
    expect(mocks.hasMenuPermission).toHaveBeenCalledWith(expect.any(Request), "activity");
  });

  it("passes filters through, and on the first page also purges and summarises repeats", async () => {
    await get("?username=6928&action=count.confirm&outcome=failed&startDate=2026-09-01&endDate=2026-09-29&limit=50");
    expect(mocks.listAppEvents).toHaveBeenCalledWith({
      username: "6928", action: "count.confirm", outcome: "failed", startDate: "2026-09-01", endDate: "2026-09-29", before: undefined, limit: 50,
    });
    expect(mocks.purgeOldAppEvents).toHaveBeenCalledTimes(1);
    expect(mocks.getRepeatedFailures).toHaveBeenCalledTimes(1);
  });

  it("skips purge and the repeat summary when paging with a cursor", async () => {
    await get("?before=120");
    expect(mocks.listAppEvents).toHaveBeenCalledWith(expect.objectContaining({ before: 120 }));
    expect(mocks.purgeOldAppEvents).not.toHaveBeenCalled();
    expect(mocks.getRepeatedFailures).not.toHaveBeenCalled();
  });

  it("still answers when the purge fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.purgeOldAppEvents.mockRejectedValue(new Error("db down"));
    mocks.listAppEvents.mockResolvedValue({ items: [{ id: 1 }], nextCursor: null });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).items).toHaveLength(1);
    spy.mockRestore();
  });

  it("returns 500 when the query fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.listAppEvents.mockRejectedValue(new Error("boom"));
    expect((await get()).status).toBe(500);
    spy.mockRestore();
  });
});
