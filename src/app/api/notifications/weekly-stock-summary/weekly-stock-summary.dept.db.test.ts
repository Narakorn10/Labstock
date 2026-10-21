import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of /api/notifications/weekly-stock-summary on the production schema + v30-v35 (PGlite).
// Every non-Vendor recipient (staff, Manager, Admin alike) gets one summary per department they are a member of, with that
// department's items only; Vendors get one summary with their own vendor's items among the items the scope can see
// (cron: every department; a one-department Manager: that department only), TEMPORARY policy, item 3 in
// docs/departments-rollout.md.

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
import { GET, POST } from "./route";

const sql = dbSql as unknown as PgliteSql;
const managerA = { username: "mgrA", name: "Manager A", role: "Manager", scope: DEPT_A };
const adminAll = { username: "admin1", name: "Admin", role: "Admin", scope: "ALL" };
const url = "http://localhost/api/notifications/weekly-stock-summary";
const call = (headers: Record<string, string> = {}) => POST(new Request(url, { method: "POST", headers }));
const cron = () => call({ "x-cron-secret": "weekly-secret" });
const sorted = (messages: Record<string, string[][]>) => Object.fromEntries(Object.entries(messages).map(([user, list]) => [user, list.map((ids) => [...ids]).sort()]));

// What each department's summary holds (all four items are low; lots exist for N-A1, N-A2 and N-B1).
const summaryA = ["low:N-A1", "low:N-A2", "exp:N-A1", "exp:N-A2"];
const summaryB = ["low:N-B1", "low:N-B2", "exp:N-B1"];

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addNotificationFixtures(sql);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  mocks.line.length = 0;
  mocks.getAuthenticatedUser.mockReset();
  mocks.getAuthenticatedUser.mockResolvedValue(null);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("WEEKLY_STOCK_NOTIFICATION_CRON_SECRET", "weekly-secret");
  vi.stubEnv("CRON_SECRET", "generic-secret");
  vi.stubEnv("DEPARTMENTS_ENABLED", "true");
  resetDepartmentsFlagForTests();
  await sql.db.exec(`
    UPDATE master_data SET min_threshold = 5 WHERE item_id IN ('N-A1', 'N-A2', 'N-B1', 'N-B2');
    DELETE FROM inventory;
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity) VALUES
      ('N-A1', 'L-A1', CURRENT_DATE + 10, 3), ('N-A2', 'L-A2', CURRENT_DATE + 10, 3), ('N-B1', 'L-B1', CURRENT_DATE + 10, 3);
  `);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

describe("weekly-stock-summary by department", () => {
  it("cron: members get one summary per department with only that department's items; Vendors get one summary; non-members get nothing", async () => {
    const response = await cron();
    const text = JSON.stringify(await response.clone().json());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, notifiedUsers: 4, notifiedVendors: 2, lowStockItems: 4, expiringSoonItems: 3, skippedUsers: 2 });
    expect(sorted(messagesByUser(mocks.line))).toEqual({
      solo1: [summaryA],
      solo2: [summaryB],
      user1: [summaryA, summaryB], // member of A and B: two messages, never one mixed message
      admin1: [summaryA], // Admin follows the same rule as everyone else
      vendA: [["low:N-A1", "low:N-B1", "exp:N-A1", "exp:N-B1"]], // Vendor A across departments, once
      vendB: [["low:N-A2", "low:N-B2", "exp:N-A2"]],
    });
    // The two non-Vendor recipients without a membership row are only counted: no name in the response or any log line.
    const logged = [console.log, console.warn, console.error].flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.flat()).join("\n");
    for (const name of ["newbie", "adminNone"]) {
      expect(text).not.toContain(name);
      expect(logged).not.toContain(name);
    }
    expect(logged).toContain("2 staff recipient(s) skipped");
  });

  it("a department with nothing to report still gets its (empty) summary, as legacy always sends", async () => {
    await sql.db.exec(`UPDATE master_data SET min_threshold = -1 WHERE department_id = ${DEPT_B}; DELETE FROM inventory WHERE item_id = 'N-B1';`);

    const response = await cron();

    expect(await response.json()).toMatchObject({ notifiedUsers: 4, lowStockItems: 2, expiringSoonItems: 2 });
    expect(sorted(messagesByUser(mocks.line))).toMatchObject({ solo2: [[]], user1: [[], summaryA].sort() });
  });

  it("a Manager of department A: no department B item reaches anybody, members of A+B get only A", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(managerA);

    const response = await call();

    expect(await response.json()).toEqual({ success: true, notifiedUsers: 3, notifiedVendors: 2, lowStockItems: 2, expiringSoonItems: 2, skippedUsers: 2 });
    const messages = sorted(messagesByUser(mocks.line));
    expect(messages).toEqual({
      solo1: [summaryA],
      user1: [summaryA],
      admin1: [summaryA],
      vendA: [["low:N-A1", "exp:N-A1"]],
      vendB: [["low:N-A2", "exp:N-A2"]],
    });
    expect(JSON.stringify(messages)).not.toContain("N-B");
  });

  it("a global Admin (scope ALL) behaves like the cron", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    expect(await (await call()).json()).toMatchObject({ notifiedUsers: 4, lowStockItems: 4, expiringSoonItems: 3 });
  });

  it("accepts the other secret name and Authorization: Bearer, and GET", async () => {
    expect((await call({ "x-cron-secret": "generic-secret" })).status).toBe(200);
    expect((await call({ authorization: "Bearer weekly-secret" })).status).toBe(200);
    expect((await GET(new Request(url, { method: "GET", headers: { authorization: "Bearer generic-secret" } }))).status).toBe(200);
  });

  it("departments off on the two-department data: every non-Vendor gets one summary with everything, as before", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "");
    resetDepartmentsFlagForTests();

    const response = await cron();

    // no skippedUsers key: the legacy response keeps exactly its original keys
    expect(await response.json()).toEqual({ success: true, notifiedUsers: 6, notifiedVendors: 2, lowStockItems: 4, expiringSoonItems: 3 });
    const everything = ["low:N-A1", "low:N-A2", "low:N-B1", "low:N-B2", "exp:N-A1", "exp:N-A2", "exp:N-B1"];
    const messages = sorted(messagesByUser(mocks.line));
    for (const user of ["solo1", "solo2", "user1", "admin1", "adminNone", "newbie"]) expect(messages[user]).toEqual([everything]);
    expect(messages.vendA).toEqual([["low:N-A1", "low:N-B1", "exp:N-A1", "exp:N-B1"]]);
  });

  it("answers 401 for a plain User and a wrong secret; denied -> 404; missing scope -> 500 without the user name", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "solo1", role: "User", scope: DEPT_A });
    expect((await call()).status).toBe(401);
    expect((await call({ "x-cron-secret": "wrong" })).status).toBe(401);

    mocks.getAuthenticatedUser.mockResolvedValue({ username: "mgrB", role: "Manager", scope: DEPT_B, departmentDenied: true });
    expect((await call()).status).toBe(404);

    mocks.getAuthenticatedUser.mockResolvedValue({ username: "mgrNoScope", role: "Manager" });
    const missing = await call();
    expect(missing.status).toBe(500);
    expect(JSON.stringify(await missing.json())).not.toContain("mgrNoScope");
    expect(mocks.line).toHaveLength(0);
  });
});
