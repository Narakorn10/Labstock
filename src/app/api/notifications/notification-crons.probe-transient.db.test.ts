import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyProdSchema, DEPT_A, seedTwoDepartments } from "@/test/department-fixtures";
import { addNotificationFixtures, messagesByUser } from "@/test/notification-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Cron-route level proof for PR #71 (departments-flag fail-open). With DEPARTMENTS_ENABLED=true and a freshly started instance
// (the schema was never confirmed), the readiness probe (the statement containing to_regclass('public.user_departments')) dies
// with a network-style error. The crons that PR #69 moved to departments must then still filter by department: before #71
// the probe error meant "legacy" and every recipient was sent every department's items.
// Each scenario runs three times with identical expectations: no failure (control), first probe fails once, every probe fails.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
type Failure = null | "once" | "always";

const h = vi.hoisted(() => ({
  target: null as null | PgliteSql,
  failure: null as null | "once" | "always",
  probeFailures: 0,
  probeCalls: 0,
  auth: vi.fn(),
  line: [] as Array<{ fn: string; args: unknown[] }>,
}));

const PROBE_MARKER = "to_regclass('public.user_departments')";

// Only the readiness probe is made to fail (a network-style error, no SQLSTATE); every other statement reaches the real PGlite.
// The failure is lazy like a real query: it only rejects when awaited, so a statement that is built but never awaited stays silent.
vi.mock("@/lib/db", () => {
  const wrapper = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes(PROBE_MARKER)) {
      h.probeCalls++;
      if (h.failure === "always" || (h.failure === "once" && h.probeFailures === 0)) {
        h.probeFailures++;
        return { then: (_ok: unknown, onRejected?: (reason: unknown) => unknown) => Promise.reject(new Error("fetch failed")).catch(onRejected) };
      }
    }
    return (h.target as unknown as Impl)(strings, ...values);
  };
  wrapper.unsafe = (text: string) => (h.target as PgliteSql).unsafe(text);
  wrapper.transaction = (queries: Parameters<PgliteSql["transaction"]>[0]) => (h.target as PgliteSql).transaction(queries);
  return { default: wrapper };
});
// The real getAuthenticatedUser / getDepartmentScope run (they call the readiness probe); only the Auth.js session is faked.
vi.mock("@/auth", () => ({ auth: h.auth }));
// notifyUsers destructures all of these from the module, and a vitest factory mock throws on an export it does not define.
vi.mock("@/lib/line-bot", () => {
  const record = (fn: string) => async (...args: unknown[]) => { h.line.push({ fn, args }); };
  return {
    sendLinePush: record("sendLinePush"),
    pushPONotification: record("pushPONotification"),
    pushLowStockAlert: record("pushLowStockAlert"),
    pushExpiringSoonAlert: record("pushExpiringSoonAlert"),
    pushWeeklyStockSummary: record("pushWeeklyStockSummary"),
    pushWeeklyStockAlerts: record("pushWeeklyStockAlerts"),
  };
});

import { departmentsReady, resetDepartmentsFlagForTests, setDepartmentsClockForTests } from "@/lib/departments-flag";
import { POST as expiringSoon } from "./expiring-soon/route";
import { POST as vendorLowStock } from "./vendor-low-stock/route";
import { POST as weeklySummary } from "./weekly-stock-summary/route";

let migrated: PgliteSql;
let premigration: PgliteSql;

function sessionAs(username: string, role: string) {
  h.auth.mockResolvedValue({ user: { username, name: username, role, vendor: "", sessionVersion: 1 } });
}
const post = (path: string, route: typeof weeklySummary, headers: Record<string, string>) =>
  route(new Request(`http://localhost/api/notifications/${path}`, { method: "POST", headers }));
const weeklyCron = () => post("weekly-stock-summary", weeklySummary, { "x-cron-secret": "weekly-secret" });
const weeklyUser = () => post("weekly-stock-summary", weeklySummary, {});
const expiringCron = () => post("expiring-soon", expiringSoon, { "x-cron-secret": "expiry-secret" });
const expiringUser = () => post("expiring-soon", expiringSoon, {});
const lowStockCron = () => post("vendor-low-stock", vendorLowStock, { "x-cron-secret": "lowstock-secret" });
const lowStockUser = () => post("vendor-low-stock", vendorLowStock, {});
const sorted = (messages: Record<string, string[][]>) => Object.fromEntries(Object.entries(messages).map(([user, list]) => [user, list.map((ids) => [...ids]).sort()]));
const loggedItems = async (db: PgliteSql) => (await db.db.query<{ item_id: string }>("SELECT item_id FROM expiry_notification_logs ORDER BY item_id")).rows.map((row) => row.item_id);

// What each department's weekly summary holds (all four items are low; lots exist for N-A1, N-A2 and N-B1).
const summaryA = ["low:N-A1", "low:N-A2", "exp:N-A1", "exp:N-A2"];
const summaryB = ["low:N-B1", "low:N-B2", "exp:N-B1"];

// DATE (oid 1082) comes back as a local-midnight Date on @neondatabase/serverless 1.1.0; mimic it like expiring-soon.dept.db.test.ts.
const neonDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite({ parsers: { 1082: neonDate } }));
  await seedTwoDepartments(migrated);
  await addNotificationFixtures(migrated);
  await migrated.db.exec(`
    INSERT INTO users (username, password_hash, name, role, vendor) VALUES ('mgrA', 'x', 'Manager A', 'Manager', '');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('mgrA', ${DEPT_A}, NULL, true);
  `);
  // Production schema before upgrade_v30 (no departments, no user_departments, no department_id) with a minimal legacy dataset.
  premigration = createPgliteSql(new PGlite({ parsers: { 1082: neonDate } }));
  await applyProdSchema(premigration.db);
  await premigration.db.exec(`
    CREATE TABLE notification_settings (
      username TEXT PRIMARY KEY, email TEXT, line_user_id TEXT,
      notify_po_created BOOLEAN, notify_po_confirmed BOOLEAN, notify_po_shipped BOOLEAN, notify_po_received BOOLEAN,
      notify_low_stock BOOLEAN DEFAULT true, notify_expiring_soon BOOLEAN DEFAULT true, notify_weekly_summary BOOLEAN DEFAULT true
    );
    INSERT INTO users (username, password_hash, name, role, vendor) VALUES
      ('staffP', 'x', 'Staff', 'User', ''), ('vendP', 'x', 'Vendor P', 'Vendor', 'Vendor P');
    INSERT INTO notification_settings (username, line_user_id) VALUES ('staffP', 'U-staffP'), ('vendP', 'U-vendP');
    UPDATE master_data SET min_threshold = -1;
    INSERT INTO master_data (item_id, name, unit, vendor, min_threshold) VALUES ('P-1', 'Pre 1', 'box', 'Vendor P', 5), ('P-2', 'Pre 2', 'box', 'Vendor P', 5);
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity) VALUES ('P-1', 'LP-1', CURRENT_DATE + 10, 3), ('P-2', 'LP-2', CURRENT_DATE + 10, 3);
  `);
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
  await premigration.db.close();
});

beforeEach(() => {
  h.line.length = 0;
  h.failure = null;
  h.probeFailures = 0;
  h.probeCalls = 0;
  h.target = migrated;
  h.auth.mockReset();
  h.auth.mockResolvedValue(null);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("WEEKLY_STOCK_NOTIFICATION_CRON_SECRET", "weekly-secret");
  vi.stubEnv("EXPIRY_NOTIFICATION_CRON_SECRET", "expiry-secret");
  vi.stubEnv("LOW_STOCK_NOTIFICATION_CRON_SECRET", "lowstock-secret");
  vi.stubEnv("DEPARTMENTS_ENABLED", "true");
  resetDepartmentsFlagForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
  setDepartmentsClockForTests();
});

const scenarios: Array<[string, Failure]> = [
  ["control: the readiness probe succeeds", null],
  ["the first readiness probe of a fresh instance fails once", "once"],
  ["every readiness probe fails (other queries pass)", "always"],
];

// The probe really failed as described, so a green run cannot come from an injection that silently did nothing.
function expectInjected(failure: Failure) {
  if (failure === null) expect(h.probeFailures).toBe(0);
  if (failure === "once") expect(h.probeFailures).toBe(1);
  if (failure === "always") expect(h.probeFailures).toBeGreaterThanOrEqual(1);
  expect(h.probeCalls).toBeGreaterThanOrEqual(1);
}

describe.each(scenarios)("two departments, flag on: %s", (_label, failure) => {
  beforeEach(async () => {
    h.failure = failure;
    await migrated.db.exec(`
      UPDATE master_data SET min_threshold = 5 WHERE item_id IN ('N-A1', 'N-A2', 'N-B1', 'N-B2');
      DELETE FROM inventory;
      INSERT INTO inventory (item_id, lot_no, exp_date, quantity) VALUES
        ('N-A1', 'L-A1', CURRENT_DATE + 10, 3), ('N-A2', 'L-A2', CURRENT_DATE + 10, 3), ('N-B1', 'L-B1', CURRENT_DATE + 10, 3);
      DROP TABLE IF EXISTS expiry_notification_logs;
    `);
  });

  it("weekly-stock-summary cron: solo1 only gets department A, solo2 only B, user1 both separately, newbie/adminNone nothing", async () => {
    const response = await weeklyCron();

    expect(response.status).toBe(200);
    expect(sorted(messagesByUser(h.line))).toEqual({
      solo1: [summaryA],
      solo2: [summaryB],
      user1: [summaryA, summaryB],
      admin1: [summaryA],
      vendA: [["low:N-A1", "low:N-B1", "exp:N-A1", "exp:N-B1"]],
      vendB: [["low:N-A2", "low:N-B2", "exp:N-A2"]],
    });
    expect(await response.json()).toEqual({ success: true, notifiedUsers: 4, notifiedVendors: 2, lowStockItems: 4, expiringSoonItems: 3, skippedUsers: 2 });
    expectInjected(failure);
  });

  it("weekly-stock-summary run by a Manager of department A: no department B item reaches anybody", async () => {
    sessionAs("mgrA", "Manager");

    const response = await weeklyUser();

    expect(response.status).toBe(200);
    expect(sorted(messagesByUser(h.line))).toEqual({
      solo1: [summaryA],
      user1: [summaryA],
      admin1: [summaryA],
      vendA: [["low:N-A1", "exp:N-A1"]],
      vendB: [["low:N-A2", "exp:N-A2"]],
    });
    expect(await response.json()).toEqual({ success: true, notifiedUsers: 3, notifiedVendors: 2, lowStockItems: 2, expiringSoonItems: 2, skippedUsers: 2 });
    expectInjected(failure);
  });

  it("expiring-soon cron: each staff member only gets lots of their own departments; only lots with a recipient are logged", async () => {
    await migrated.db.exec("INSERT INTO inventory (item_id, lot_no, exp_date, quantity) VALUES ('N-B2', 'L-B2', CURRENT_DATE + 10, 3)");

    const response = await expiringCron();

    expect(response.status).toBe(200);
    expect(sorted(messagesByUser(h.line))).toEqual({
      solo1: [["N-A1", "N-A2"]],
      solo2: [["N-B1", "N-B2"]],
      user1: [["N-A1", "N-A2"], ["N-B1", "N-B2"]],
      admin1: [["N-A1", "N-A2"]],
      vendA: [["N-A1", "N-B1"]],
      vendB: [["N-A2", "N-B2"]],
    });
    expect(await response.json()).toEqual({ success: true, notified: 4, recipients: 6, skippedLots: 0, skippedRecipients: 2 });
    expect(await loggedItems(migrated)).toEqual(["N-A1", "N-A2", "N-B1", "N-B2"]);
    expectInjected(failure);
  });

  it("expiring-soon run by an Admin of department A: only department A lots are sent and logged", async () => {
    await migrated.db.exec("INSERT INTO inventory (item_id, lot_no, exp_date, quantity) VALUES ('N-B2', 'L-B2', CURRENT_DATE + 10, 3)");
    sessionAs("admin1", "Admin");

    const response = await expiringUser();

    expect(response.status).toBe(200);
    expect(sorted(messagesByUser(h.line))).toEqual({
      solo1: [["N-A1", "N-A2"]],
      user1: [["N-A1", "N-A2"]],
      admin1: [["N-A1", "N-A2"]],
      vendA: [["N-A1"]],
      vendB: [["N-A2"]],
    });
    expect(await response.json()).toMatchObject({ success: true, notified: 2 });
    expect(await loggedItems(migrated)).toEqual(["N-A1", "N-A2"]);
    expectInjected(failure);
  });

  it("vendor-low-stock cron: each Vendor gets their items across departments (mode all), as normal", async () => {
    const response = await lowStockCron();

    expect(response.status).toBe(200);
    expect(messagesByUser(h.line)).toEqual({ vendA: [["N-A1", "N-B1"]], vendB: [["N-A2", "N-B2"]] });
    expect(await response.json()).toEqual({ success: true, notifiedVendors: 2, notifiedItems: 4 });
    expectInjected(failure);
  });

  it("vendor-low-stock pressed by a Manager of department A (scope one): only department A items", async () => {
    sessionAs("mgrA", "Manager");

    const response = await lowStockUser();

    expect(response.status).toBe(200);
    expect(messagesByUser(h.line)).toEqual({ vendA: [["N-A1"]], vendB: [["N-A2"]] });
    expect(await response.json()).toEqual({ success: true, notifiedVendors: 2, notifiedItems: 2 });
    expectInjected(failure);
  });
});

// Reverse case: the flag was switched on before the migrations ran.
describe("pre-migration schema (no user_departments), flag on", () => {
  beforeEach(() => {
    h.target = premigration;
  });

  const legacyRoutes: Array<[string, () => Promise<Response>, object, Record<string, string[][]>, number]> = [
    ["weekly-stock-summary", weeklyCron, { success: true, notifiedUsers: 1, notifiedVendors: 1, lowStockItems: 2, expiringSoonItems: 2 },
      { staffP: [["low:P-1", "low:P-2", "exp:P-1", "exp:P-2"]], vendP: [["low:P-1", "low:P-2", "exp:P-1", "exp:P-2"]] }, 500],
    ["expiring-soon", expiringCron, { success: true, notified: 2, recipients: 2 }, { staffP: [["P-1", "P-2"]], vendP: [["P-1", "P-2"]] }, 500],
    // Vendors only and scope "all" adds no department filter, so this cron never touches the missing schema: it just works.
    ["vendor-low-stock", lowStockCron, { success: true, notifiedVendors: 1, notifiedItems: 2 }, { vendP: [["P-1", "P-2"]] }, 200],
  ];

  describe.each(legacyRoutes)("%s", (name, run, body, messages, statusWhileAssumedReady) => {
    beforeEach(async () => {
      await premigration.db.exec("DROP TABLE IF EXISTS expiry_notification_logs");
    });

    it("probe succeeds and sees the schema missing: legacy path, 200, everyone gets everything, no throw", async () => {
      const response = await run();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(body);
      expect(sorted(messagesByUser(h.line))).toEqual(messages);
      expect(h.probeFailures).toBe(0);
      await expect(departmentsReady()).resolves.toBe(false);
      if (name === "expiring-soon") expect(await loggedItems(premigration)).toEqual(["P-1", "P-2"]);
    });

    // DOCUMENTED, accepted downside of src/lib/departments-flag.ts (flag on before migrations AND the probe fails on a fresh
    // instance): "ready" is assumed, the department query hits the missing schema and the cron answers 500 (never a leak, never
    // an unhandled throw) until a probe succeeds after RETRY_MS, which then flips to legacy.
    it("first probe fails on a fresh instance: department routes answer 500 with nothing sent (documented downside), then legacy once a probe succeeds", async () => {
      h.failure = "once";
      let now = 1_000_000;
      setDepartmentsClockForTests(() => now);

      const failed = await run();

      expect(failed.status).toBe(statusWhileAssumedReady);
      expect(h.probeFailures).toBe(1);
      if (statusWhileAssumedReady === 500) expect(h.line).toHaveLength(0);
      else expect(sorted(messagesByUser(h.line))).toEqual(messages);
      h.line.length = 0;
      await premigration.db.exec("DROP TABLE IF EXISTS expiry_notification_logs");

      now += 6_000; // past RETRY_MS (5 s)
      const recovered = await run();

      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toEqual(body);
      expect(sorted(messagesByUser(h.line))).toEqual(messages);
      await expect(departmentsReady()).resolves.toBe(false);
    });
  });
});
