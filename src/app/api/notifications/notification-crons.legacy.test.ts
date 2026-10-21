import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PgliteSql } from "@/test/pglite-sql";

// With DEPARTMENTS_ENABLED off (scope { mode: "legacy" }), the three notification crons (expiring-soon, vendor-low-stock,
// weekly-stock-summary) must do EXACTLY what they did before the department change: same SQL text, same params, same number
// of statements, same arguments reaching the LINE / e-mail senders, same JSON response. The baseline JSON was captured from
// the ORIGINAL routes (main 7aa0dd8), before any of them was touched.
//
// LIMIT: this proves identity only through the PGlite shim (createPgliteSql), which composes nested sql fragments itself.
// It was never run against Neon: check the scoped queries on real Neon at rehearsal before enabling the flag.
//
// To regenerate the baseline on purpose (never done silently): UPDATE_NOTIFICATION_CRONS_BASELINE=1 npx vitest run <this file>.

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  line: [] as Array<{ fn: string; args: unknown[] }>,
  mail: [] as Array<{ to: unknown; subject: unknown }>,
}));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
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
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { to: unknown; subject: unknown }) => { mocks.mail.push({ to: message.to, subject: message.subject }); },
    }),
  },
}));

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { POST as expiringPOST } from "./expiring-soon/route";
import { POST as vendorLowStockPOST } from "./vendor-low-stock/route";
import { GET as weeklyGET, POST as weeklyPOST } from "./weekly-stock-summary/route";

const sql = dbSql as unknown as PgliteSql;
const BASELINE_PATH = path.resolve(process.cwd(), "src/app/api/notifications/notification-crons.legacy-baseline.json");

type Row = Record<string, unknown>;
type Captured = Array<{ text: string; params: unknown[] }>;
type Responder = (text: string, params: unknown[]) => Row[];

const admin = { username: "admin1", name: "Admin One", role: "Admin" };
const manager = { username: "manager1", name: "Manager One", role: "Manager" };
const plainUser = { username: "user1", name: "User One", role: "User" };

// Recipients: staff with LINE + e-mail, staff with e-mail only, a Vendor with LINE, a Vendor with no vendor name.
const staffLine = { username: "staff1", email: "staff1@lab.test", line_user_id: "U-staff1", role: "User", vendor: "" };
const staffMail = { username: "staff2", email: "staff2@lab.test", line_user_id: null, role: "Manager", vendor: "" };
const vendorA = { username: "venda", email: null, line_user_id: "U-venda", role: "Vendor", vendor: "Vendor A" };
const vendorB = { username: "vendb", email: "vendb@lab.test", line_user_id: "U-vendb", role: "Vendor", vendor: "Vendor B" };
const vendorNoName = { username: "vendx", email: "vendx@lab.test", line_user_id: null, role: "Vendor", vendor: "" };
const flags = { notify_expiring_soon: true, notify_low_stock: true, notify_weekly_summary: true };
const recipients = [staffLine, staffMail, vendorA, vendorB, vendorNoName].map((row) => ({ ...row, ...flags }));

const expiringRows = [
  { itemId: "A-1", name: "Reagent A1", lotNo: "L1", expDate: "2026-08-20", quantity: 3, unit: "box", daysUntilExpiry: 10, vendor: "Vendor A" },
  { itemId: "B-1", name: "Reagent B1", lotNo: "L2", expDate: "2026-08-25", quantity: "5", unit: "kit", daysUntilExpiry: 15, vendor: "Vendor B" },
  { itemId: "N-1", name: "No vendor item", lotNo: "L3", expDate: "2026-08-30", quantity: 1, unit: "box", daysUntilExpiry: 20, vendor: "" },
];
const lowStockRows = [
  { vendor: "Vendor A", itemId: "A-1", name: "Reagent A1", unit: "box", minThreshold: 5, quantity: 1 },
  { vendor: "Vendor A", itemId: "A-2", name: "Reagent A2", unit: "box", minThreshold: "4", quantity: "0" },
  { vendor: "Vendor B", itemId: "B-1", name: "Reagent B1", unit: "kit", minThreshold: 2, quantity: 2 },
  { vendor: "Vendor C", itemId: "C-1", name: "Reagent C1", unit: "kit", minThreshold: 2, quantity: 0 },
];
const weeklyLowRows = [
  { itemId: "A-1", name: "Reagent A1", unit: "box", minThreshold: "5", jobType: "Chem", vendor: "Vendor A", quantity: "1" },
  { itemId: "B-1", name: "Reagent B1", unit: "kit", minThreshold: 2, jobType: "ไม่ระบุงาน", vendor: "Vendor B", quantity: 0 },
];
const weeklyExpiringRows = [
  { itemId: "A-1", name: "Reagent A1", lotNo: "L1", expDate: "2026-08-20", quantity: "3", unit: "box", daysUntilExpiry: "10", jobType: "Chem", vendor: "Vendor A" },
];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-10T03:04:05.678Z"));
  vi.stubEnv("DEPARTMENTS_ENABLED", "");
  vi.stubEnv("EXPIRY_NOTIFICATION_CRON_SECRET", "expiry-secret");
  vi.stubEnv("LOW_STOCK_NOTIFICATION_CRON_SECRET", "lowstock-secret");
  vi.stubEnv("WEEKLY_STOCK_NOTIFICATION_CRON_SECRET", "weekly-secret");
  vi.stubEnv("CRON_SECRET", "generic-secret");
  vi.stubEnv("SMTP_USER", "lab@lab.test");
  vi.stubEnv("NEXT_PUBLIC_LINE_ORDER_LIFF_URL", "");
  vi.stubEnv("NEXT_PUBLIC_LINE_ORDER_LIFF_ID", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://lab.test/");
  resetDepartmentsFlagForTests();
  mocks.getAuthenticatedUser.mockReset();
  mocks.getAuthenticatedUser.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetDepartmentsFlagForTests();
});

afterAll(async () => {
  await sql.db.close();
});

// Records every statement the route sends (the harness composes nested fragments before PGlite sees them) and answers by text.
async function capture(run: () => Promise<Response>, respond: Responder = () => []) {
  const captured: Captured = [];
  mocks.line.length = 0;
  mocks.mail.length = 0;
  const spy = vi.spyOn(sql.db, "query").mockImplementation((async (text: string, params: unknown[]) => {
    captured.push({ text, params });
    return { rows: respond(text, params) };
  }) as never);
  const response = await run();
  spy.mockRestore();
  return {
    status: response.status,
    body: await response.json(),
    statements: captured,
    line: mocks.line.map((entry) => ({ fn: entry.fn, args: entry.args })),
    mail: mocks.mail.map((entry) => ({ ...entry })),
  };
}

const request = (url: string, headers: Record<string, string> = {}, method = "POST") => new Request(`http://localhost${url}`, { method, headers });

const expiringResponder = (settings: Row[], items: Row[]): Responder => (text) => {
  if (/FROM notification_settings/.test(text)) return settings;
  if (/FROM inventory i/.test(text)) return items;
  return [];
};
const lowStockResponder = (items: Row[], settings: Row[]): Responder => (text, params) => {
  if (/FROM notification_settings/.test(text)) return settings.filter((row) => row.vendor === params[0]);
  if (/inventory_summary/.test(text)) return items;
  return [];
};
const weeklyResponder = (settings: Row[]): Responder => (text) => {
  if (/FROM notification_settings/.test(text)) return settings;
  if (/WITH inventory_summary/.test(text)) return weeklyLowRows;
  if (/FROM inventory i/.test(text)) return weeklyExpiringRows;
  return [];
};

describe("notification crons with departments off (legacy)", () => {
  it("sends exactly the pre-change statements and notifications", async () => {
    const asUser = (user: unknown) => mocks.getAuthenticatedUser.mockResolvedValue(user);
    const results = {
      expiringCron: await capture(() => expiringPOST(request("/api/notifications/expiring-soon", { "x-cron-secret": "expiry-secret" })), expiringResponder(recipients, expiringRows)),
      expiringNoRecipients: await capture(() => expiringPOST(request("/api/notifications/expiring-soon", { "x-cron-secret": "expiry-secret" })), expiringResponder([], expiringRows)),
      expiringNoLots: await capture(() => expiringPOST(request("/api/notifications/expiring-soon", { "x-cron-secret": "expiry-secret" })), expiringResponder(recipients, [])),
      expiringAdmin: await capture(() => { asUser(admin); return expiringPOST(request("/api/notifications/expiring-soon")); }, expiringResponder(recipients, expiringRows)),
      expiringManagerDenied: await capture(() => { asUser(manager); return expiringPOST(request("/api/notifications/expiring-soon")); }, expiringResponder(recipients, expiringRows)),
      expiringWrongSecret: await capture(() => expiringPOST(request("/api/notifications/expiring-soon", { "x-cron-secret": "nope" })), expiringResponder(recipients, expiringRows)),

      lowStockCron: await capture(() => vendorLowStockPOST(request("/api/notifications/vendor-low-stock", { "x-cron-secret": "lowstock-secret" })), lowStockResponder(lowStockRows, recipients)),
      lowStockManager: await capture(() => { asUser(manager); return vendorLowStockPOST(request("/api/notifications/vendor-low-stock")); }, lowStockResponder(lowStockRows, recipients)),
      lowStockNone: await capture(() => vendorLowStockPOST(request("/api/notifications/vendor-low-stock", { "x-cron-secret": "lowstock-secret" })), lowStockResponder([], recipients)),
      lowStockUserDenied: await capture(() => { asUser(plainUser); return vendorLowStockPOST(request("/api/notifications/vendor-low-stock")); }, lowStockResponder(lowStockRows, recipients)),

      weeklyCronHeaderWeeklySecret: await capture(() => weeklyPOST(request("/api/notifications/weekly-stock-summary", { "x-cron-secret": "weekly-secret" })), weeklyResponder(recipients)),
      weeklyCronHeaderCronSecret: await capture(() => weeklyPOST(request("/api/notifications/weekly-stock-summary", { "x-cron-secret": "generic-secret" })), weeklyResponder(recipients)),
      weeklyCronBearerWeeklySecret: await capture(() => weeklyPOST(request("/api/notifications/weekly-stock-summary", { authorization: "Bearer weekly-secret" })), weeklyResponder(recipients)),
      weeklyCronBearerCronSecret: await capture(() => weeklyPOST(request("/api/notifications/weekly-stock-summary", { authorization: "Bearer generic-secret" })), weeklyResponder(recipients)),
      weeklyGet: await capture(() => weeklyGET(request("/api/notifications/weekly-stock-summary", { "x-cron-secret": "weekly-secret" }, "GET")), weeklyResponder(recipients)),
      weeklyManager: await capture(() => { asUser(manager); return weeklyPOST(request("/api/notifications/weekly-stock-summary")); }, weeklyResponder(recipients)),
      weeklyDenied: await capture(() => { asUser(plainUser); return weeklyPOST(request("/api/notifications/weekly-stock-summary")); }, weeklyResponder(recipients)),
    };

    // Sanity: a wrong status means the scenario never reached what it is meant to cover.
    expect(Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.status]))).toEqual({
      expiringCron: 200, expiringNoRecipients: 200, expiringNoLots: 200, expiringAdmin: 200, expiringManagerDenied: 401, expiringWrongSecret: 401,
      lowStockCron: 200, lowStockManager: 200, lowStockNone: 200, lowStockUserDenied: 401,
      weeklyCronHeaderWeeklySecret: 200, weeklyCronHeaderCronSecret: 200, weeklyCronBearerWeeklySecret: 200, weeklyCronBearerCronSecret: 200,
      weeklyGet: 200, weeklyManager: 200, weeklyDenied: 401,
    });
    expect(results.expiringManagerDenied.statements).toHaveLength(0);
    expect(results.lowStockUserDenied.statements).toHaveLength(0);
    expect(results.weeklyDenied.statements).toHaveLength(0);
    expect(results.expiringCron.line.length).toBeGreaterThan(0);
    expect(results.weeklyCronBearerCronSecret.line.length).toBeGreaterThan(0);

    if (process.env.UPDATE_NOTIFICATION_CRONS_BASELINE === "1") writeFileSync(BASELINE_PATH, `${JSON.stringify(results, null, 2)}\n`);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as typeof results;
    const actual = JSON.parse(JSON.stringify(results)) as typeof results;

    expect(Object.keys(actual)).toEqual(Object.keys(baseline));
    for (const key of Object.keys(baseline) as Array<keyof typeof results>) {
      expect(actual[key].statements, `${key} statement count`).toHaveLength(baseline[key].statements.length);
      actual[key].statements.forEach((query, index) => {
        expect(query.text, `${key}[${index}] text`).toBe(baseline[key].statements[index].text);
        expect(query.params, `${key}[${index}] params`).toEqual(baseline[key].statements[index].params);
        expect(query.text).not.toMatch(/department_id|user_departments/i);
      });
    }
    expect(actual).toEqual(baseline);
  });
});
