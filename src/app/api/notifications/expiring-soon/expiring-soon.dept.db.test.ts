import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of POST /api/notifications/expiring-soon on the production schema + v30-v35 (PGlite).
// Every non-Vendor recipient (staff, Manager, Admin alike) gets only the lots of departments they are a member of, one
// message per department; Vendors get their own vendor's lots from every department ONCE (TEMPORARY policy, item 3 in
// docs/departments-rollout.md). In department mode only lots that had a recipient are logged.

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  line: [] as Array<{ fn: string; args: unknown[] }>,
}));

// Neon returns a DATE as the string "YYYY-MM-DD" and the route stores String(expDate); PGlite would return a JS Date, so
// the DATE parser (oid 1082) is switched off here to feed the route the same strings.
vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql(new PGlite({ parsers: { 1082: (value: string) => value } })) };
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
const adminA = { username: "admin1", name: "Admin", role: "Admin", scope: DEPT_A };
const adminAll = { username: "admin1", name: "Admin", role: "Admin", scope: "ALL" };
const call = (headers: Record<string, string> = {}) => POST(new Request("http://localhost/api/notifications/expiring-soon", { method: "POST", headers }));
const cron = () => call({ "x-cron-secret": "expiry-secret" });
const loggedItems = async () => (await sql.db.query<{ item_id: string }>("SELECT item_id FROM expiry_notification_logs ORDER BY item_id")).rows.map((row) => row.item_id);
const sorted = (messages: Record<string, string[][]>) => Object.fromEntries(Object.entries(messages).map(([user, list]) => [user, list.map((ids) => [...ids]).sort()]));

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addNotificationFixtures(sql);
  // A third department whose lot has no staff member and no Vendor account: nobody can be told about it.
  await sql.db.exec(`
    INSERT INTO departments (id, name, code) VALUES (3, 'Third lab', 'ZZ');
    INSERT INTO master_data (item_id, name, unit, vendor, min_threshold, department_id) VALUES ('N-C1', 'Item C1', 'box', 'Nobody Co', -1, 3);
  `);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

// One lot (10 days to expiry) per item, so every item appears in the alert.
beforeEach(async () => {
  mocks.line.length = 0;
  mocks.getAuthenticatedUser.mockReset();
  mocks.getAuthenticatedUser.mockResolvedValue(null);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("EXPIRY_NOTIFICATION_CRON_SECRET", "expiry-secret");
  vi.stubEnv("DEPARTMENTS_ENABLED", "true");
  resetDepartmentsFlagForTests();
  await sql.db.exec(`
    DROP TABLE IF EXISTS expiry_notification_logs;
    DELETE FROM inventory;
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity) VALUES
      ('N-A1', 'L-A1', CURRENT_DATE + 10, 3), ('N-A2', 'L-A2', CURRENT_DATE + 10, 3),
      ('N-B1', 'L-B1', CURRENT_DATE + 10, 3), ('N-B2', 'L-B2', CURRENT_DATE + 10, 3),
      ('N-C1', 'L-C1', CURRENT_DATE + 10, 3);
  `);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

describe("expiring-soon by department", () => {
  it("cron: members get only their departments' lots, one message per department; Vendors get one message; non-members get nothing", async () => {
    const response = await cron();
    const text = JSON.stringify(await response.clone().json());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, notified: 4, recipients: 6, skippedLots: 1, skippedRecipients: 2 });
    expect(sorted(messagesByUser(mocks.line))).toEqual({
      solo1: [["N-A1", "N-A2"]],
      solo2: [["N-B1", "N-B2"]],
      user1: [["N-A1", "N-A2"], ["N-B1", "N-B2"]], // member of A and B: two messages, never one mixed message
      admin1: [["N-A1", "N-A2"]], // Admin follows the same rule as everyone else
      vendA: [["N-A1", "N-B1"]], // once, not once per department
      vendB: [["N-A2", "N-B2"]],
    });
    // The two non-Vendor recipients without a membership row are only counted: no name in the response or any log line.
    const logged = [console.log, console.warn, console.error].flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.flat()).join("\n");
    for (const name of ["newbie", "adminNone"]) {
      expect(text).not.toContain(name);
      expect(logged).not.toContain(name);
    }
    expect(logged).toContain("2 staff recipient(s) skipped");
  });

  it("logs only the lots that had a recipient; a lot nobody could be told about stays unlogged and a rerun is still success", async () => {
    await cron();
    expect(await loggedItems()).toEqual(["N-A1", "N-A2", "N-B1", "N-B2"]);

    mocks.line.length = 0;
    const rerun = await cron();
    expect(rerun.status).toBe(200);
    expect(await rerun.json()).toEqual({ success: true, notified: 0, recipients: 0, skippedLots: 1, skippedRecipients: 2 });
    expect(mocks.line).toHaveLength(0);
    expect(await loggedItems()).toEqual(["N-A1", "N-A2", "N-B1", "N-B2"]);
  });

  it("an Admin viewing department A only notifies about department A lots, and members of A+B get only A", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminA);

    const response = await call();

    expect(await response.json()).toMatchObject({ success: true, notified: 2 });
    expect(sorted(messagesByUser(mocks.line))).toEqual({
      solo1: [["N-A1", "N-A2"]],
      user1: [["N-A1", "N-A2"]],
      admin1: [["N-A1", "N-A2"]],
      vendA: [["N-A1"]],
      vendB: [["N-A2"]],
    });
    expect(await loggedItems()).toEqual(["N-A1", "N-A2"]);
  });

  it("a global Admin (scope ALL) behaves like the cron", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    expect(await (await call()).json()).toMatchObject({ success: true, notified: 4, skippedLots: 1 });
  });

  it("departments off on the two-department data: everybody gets everything and every lot is logged, as before", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "");
    resetDepartmentsFlagForTests();

    const response = await cron();

    expect(await response.json()).toEqual({ success: true, notified: 5, recipients: 8 });
    const all = ["N-A1", "N-A2", "N-B1", "N-B2", "N-C1"];
    expect(sorted(messagesByUser(mocks.line))).toEqual({
      solo1: [all], solo2: [all], user1: [all], admin1: [all], adminNone: [all], newbie: [all],
      vendA: [["N-A1", "N-B1"]], vendB: [["N-A2", "N-B2"]],
    });
    expect(await loggedItems()).toEqual(all);
  });

  it("answers 401 for a Manager and a wrong secret; denied -> 404; missing scope -> 500 without the user name", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "mgrA", role: "Manager", scope: DEPT_A });
    expect((await call()).status).toBe(401);
    expect((await call({ "x-cron-secret": "wrong" })).status).toBe(401);

    mocks.getAuthenticatedUser.mockResolvedValue({ username: "adminB", role: "Admin", scope: DEPT_B, departmentDenied: true });
    expect((await call()).status).toBe(404);

    mocks.getAuthenticatedUser.mockResolvedValue({ username: "adminNoScope", role: "Admin" });
    const missing = await call();
    expect(missing.status).toBe(500);
    expect(JSON.stringify(await missing.json())).not.toContain("adminNoScope");
    expect(mocks.line).toHaveLength(0);
  });
});
