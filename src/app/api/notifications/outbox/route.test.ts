import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  drainNotificationOutbox: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/notification-outbox", () => ({ drainNotificationOutbox: mocks.drainNotificationOutbox }));

import { GET, POST } from "./route";

const call = (method: "GET" | "POST", headers: Record<string, string> = {}) => {
  const handler = method === "GET" ? GET : POST;
  return handler(new Request("http://localhost/api/notifications/outbox", { method, headers }));
};
const cron = { authorization: "Bearer s3cret" };

describe("/api/notifications/outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "s3cret");
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    mocks.drainNotificationOutbox.mockResolvedValue({ claimed: 2, delivered: 2, failed: 0 });
    mocks.sql.mockResolvedValue([{ status: "PENDING", count: 3 }]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("GET with the cron secret delivers the queue (what Vercel cron sends)", async () => {
    const response = await call("GET", cron);
    expect(response.status).toBe(200);
    expect(mocks.drainNotificationOutbox).toHaveBeenCalledWith(50);
    expect(await response.json()).toEqual({ success: true, claimed: 2, delivered: 2, failed: 0 });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("POST with the cron secret still delivers the queue", async () => {
    expect((await call("POST", cron)).status).toBe(200);
    expect(mocks.drainNotificationOutbox).toHaveBeenCalledTimes(1);
  });

  it("GET from a signed-in Admin or Manager only reports status and delivers nothing", async () => {
    for (const role of ["Admin", "Manager"]) {
      mocks.getAuthenticatedUser.mockResolvedValue({ username: "a", role });
      const response = await call("GET");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [{ status: "PENDING", count: 3 }] });
    }
    expect(mocks.drainNotificationOutbox).not.toHaveBeenCalled();
  });

  it("POST from a signed-in Admin delivers the queue", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "a", role: "Admin" });
    expect((await call("POST")).status).toBe(200);
    expect(mocks.drainNotificationOutbox).toHaveBeenCalledTimes(1);
  });

  it("rejects anonymous callers and a wrong secret without delivering", async () => {
    for (const headers of [{} as Record<string, string>, { authorization: "Bearer wrong" }]) {
      expect((await call("GET", headers)).status).toBe(401);
      expect((await call("POST", headers)).status).toBe(401);
    }
    expect(mocks.drainNotificationOutbox).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("rejects non-staff roles even with a session", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "u", role: "Vendor" });
    expect((await call("GET")).status).toBe(401);
    expect((await call("POST")).status).toBe(401);
    expect(mocks.drainNotificationOutbox).not.toHaveBeenCalled();
  });

  it("never treats an unset CRON_SECRET as a match", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("GET", { authorization: "Bearer " })).status).toBe(401);
    expect((await call("GET", { authorization: "" })).status).toBe(401);
    expect(mocks.drainNotificationOutbox).not.toHaveBeenCalled();
  });

  it("reports a failed delivery run as 500", async () => {
    mocks.drainNotificationOutbox.mockRejectedValue(new Error("db down"));
    const response = await call("GET", cron);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "db down" });
  });
});
