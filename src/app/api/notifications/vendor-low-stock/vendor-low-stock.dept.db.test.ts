import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of POST /api/notifications/vendor-low-stock on the production schema + v30-v35 (PGlite).
// The recipients are Vendors only: a Vendor is told about the items of their own vendor name across departments
// (TEMPORARY policy, item 3 in docs/departments-rollout.md); a one-department Manager only notifies about that department.

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  line: [] as Array<{ fn: string; args: unknown[] }>,
}));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
// notifyUsers destructures all of these from the module, and a vitest factory mock throws on an export it does not define.
vi.mock("@/lib/line-bot", () => {
  const record = (fn: string) => async (...args: unknown[]) => { mocks.line.push({ fn, args }); };
  return {
    sendLinePush: record("sendLinePush"),
    pushPONotification: record("pushPONotification"),
    pushLowStockAlert: record("pushLowStockAlert"),
    pushExpiringSoonAlert: record("pushExpiringSoonAlert"),
    pushWeeklyStockSummary: record("pushWeeklyStockSummary"),
    pushWeeklyStockAlerts: record("pushWeeklyStockAlerts"),
  };
});

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addNotificationFixtures, messagesByUser } from "@/test/notification-fixtures";
import { POST } from "./route";

const sql = dbSql as unknown as PgliteSql;
const managerA = { username: "mgrA", name: "Manager A", role: "Manager", scope: DEPT_A };
const adminAll = { username: "admin1", name: "Admin", role: "Admin", scope: "ALL" };
const call = (headers: Record<string, string> = {}) => POST(new Request("http://localhost/api/notifications/vendor-low-stock", { method: "POST", headers }));
const cron = () => call({ "x-cron-secret": "lowstock-secret" });

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addNotificationFixtures(sql);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(() => {
  mocks.line.length = 0;
  mocks.getAuthenticatedUser.mockReset();
  mocks.getAuthenticatedUser.mockResolvedValue(null);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("LOW_STOCK_NOTIFICATION_CRON_SECRET", "lowstock-secret");
  vi.stubEnv("DEPARTMENTS_ENABLED", "true");
  resetDepartmentsFlagForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

describe("vendor-low-stock by department", () => {
  it("cron: each Vendor gets their vendor's items from every department in ONE message, nobody else is messaged", async () => {
    const response = await cron();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, notifiedVendors: 2, notifiedItems: 4 });
    expect(messagesByUser(mocks.line)).toEqual({
      vendA: [["N-A1", "N-B1"]],
      vendB: [["N-A2", "N-B2"]],
    });
  });

  it("a Manager of department A only notifies about department A items", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(managerA);

    const response = await call();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, notifiedVendors: 2, notifiedItems: 2 });
    expect(messagesByUser(mocks.line)).toEqual({ vendA: [["N-A1"]], vendB: [["N-A2"]] });
  });

  it("a global Admin (scope ALL) notifies about every department, like the cron", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);

    const response = await call();

    expect(await response.json()).toEqual({ success: true, notifiedVendors: 2, notifiedItems: 4 });
    expect(messagesByUser(mocks.line)).toEqual({ vendA: [["N-A1", "N-B1"]], vendB: [["N-A2", "N-B2"]] });
  });

  it("departments off on the two-department data: the cron sends everything as before", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "");
    resetDepartmentsFlagForTests();

    const response = await cron();

    expect(await response.json()).toEqual({ success: true, notifiedVendors: 2, notifiedItems: 4 });
    expect(messagesByUser(mocks.line)).toEqual({ vendA: [["N-A1", "N-B1"]], vendB: [["N-A2", "N-B2"]] });
  });

  it("answers 401 for a plain User and for a wrong secret, with no message sent", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "solo1", role: "User", scope: DEPT_A });
    expect((await call()).status).toBe(401);
    expect((await call({ "x-cron-secret": "wrong" })).status).toBe(401);
    expect(mocks.line).toHaveLength(0);
  });

  it("department errors go through the catalogue: denied -> 404, missing scope -> 500 without the user name", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "mgrB", role: "Manager", scope: DEPT_B, departmentDenied: true });
    expect((await call()).status).toBe(404);

    mocks.getAuthenticatedUser.mockResolvedValue({ username: "mgrNoScope", role: "Manager" });
    const missing = await call();
    expect(missing.status).toBe(500);
    expect(JSON.stringify(await missing.json())).not.toContain("mgrNoScope");
    expect(mocks.line).toHaveLength(0);
  });
});
