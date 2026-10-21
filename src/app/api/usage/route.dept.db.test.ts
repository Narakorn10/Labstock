import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite, types } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// /api/usage (summary, daily, weekly, slow-moving, insights, expiry lots), /api/logs and the cron reorder-risk route per
// department, against a real in-memory Postgres with the production schema + v30-v35.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  user: null as null | Record<string, unknown>,
  notifyUsers: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({
  getAuthenticatedUser: async () => h.user,
  hasMenuPermission: async () => ({ user: h.user, allowed: Boolean(h.user) }),
}));
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  notifyUsers: h.notifyUsers,
}));

import { GET as usageGet } from "./route";
import { GET as logsGet } from "../logs/route";
import { GET as reorderRiskGet } from "../notifications/reorder-risk/route";
import { getReagentUsageInsights } from "@/lib/reagent-usage-insights";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;
const seenSql: string[] = [];

const as = (username: string, role: string, scope: number | "ALL" | null, extra: Record<string, unknown> = {}) => {
  h.user = { username, name: username, role, scope, ...extra };
};
const usageUrl = "http://localhost/api/usage?startDate=2020-01-01&endDate=2099-12-31";
const usage = () => usageGet(new Request(usageUrl));
const bodyOf = async (response: Response) => (await response.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ids = (rows: Array<{ itemId: string }>) => rows.map((row) => row.itemId).sort();

const DISPENSE = "เบิกไปหน้างาน";
const RECEIVE = "รับเข้าสต๊อกหลัก";

beforeAll(async () => {
  // @neondatabase/serverless 1.1.0 registers a parser for DATE (oid 1082; node_modules/@neondatabase/serverless/index.js ~:499)
  // so a raw DATE comes back as a JS Date at local midnight, not a string. Mimic that so code that String()s a raw DATE fails here.
  const neonDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  db = createPgliteSql(new PGlite({ parsers: { [types.DATE]: neonDate } }));
  await seedTwoDepartments(db);
  await db.db.exec(`
    CREATE TABLE notification_settings (
      username TEXT PRIMARY KEY, email TEXT, line_user_id TEXT, notify_reorder_risk BOOLEAN DEFAULT TRUE
    );
  `);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

// Department A: A-000002 (stock 10, dispensed 3, expires in 20 days), LAB-000001 (stock 5, never dispensed, expires in 10 days).
// Department B: MB-000001 (stock 7, dispensed 2, expires in 15 days), MB-000002 (stock 4, never dispensed, expires in 5 days).
beforeEach(async () => {
  seenSql.length = 0;
  h.target = db as unknown as Impl;
  h.notifyUsers.mockReset();
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await db.db.exec(`
    DELETE FROM logs;
    DELETE FROM inventory;
    DELETE FROM notification_settings;
    DROP TABLE IF EXISTS reorder_risk_notification_logs;
    UPDATE master_data SET min_threshold = 0;
    UPDATE master_data SET min_threshold = 100 WHERE item_id IN ('A-000002', 'MB-000001');
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('A-000002', 'LA1', CURRENT_DATE + 20, 10, '2026-09-01', ${DEPT_A}),
      ('LAB-000001', 'LA2', CURRENT_DATE + 10, 5, '2026-09-01', ${DEPT_A}),
      ('MB-000001', 'LB1', CURRENT_DATE + 15, 7, '2026-09-01', ${DEPT_B}),
      ('MB-000002', 'LB2', CURRENT_DATE + 5, 4, '2026-09-01', ${DEPT_B});
    INSERT INTO logs (item_id, name, lot_no, action, quantity, username, department_id) VALUES
      ('A-000002', 'Dept A extra item', 'LA1', '${DISPENSE}', 3, 'solo1', ${DEPT_A}),
      ('A-000002', 'Dept A extra item', 'LA1', '${RECEIVE}', 10, 'solo1', ${DEPT_A}),
      ('MB-000001', 'Dept B item 1', 'LB1', '${DISPENSE}', 2, 'solo2', ${DEPT_B}),
      ('MB-000002', 'Dept B item 2', 'LB2', '${RECEIVE}', 4, 'solo2', ${DEPT_B});
    INSERT INTO notification_settings (username, email) VALUES ('admin1', 'admin@example.test');
  `);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/usage", () => {
  it("room A sees only its own summary, daily, weekly, slow-moving, insights and expiry lots", async () => {
    as("admin1", "Admin", DEPT_A);
    const response = await usage();
    expect(response.status).toBe(200);
    const body = await bodyOf(response);

    expect(ids(body.summary)).toEqual(["A-000002"]);
    expect(body.summary[0]).toMatchObject({ dispensed: 3, received: 10 });
    expect(body.dailyStats).toHaveLength(1);
    expect(Object.keys(body.dailyStats[0].items)).toEqual(["A-000002"]);
    expect(body.weeklyStats.map((row: { totalDispensed: string }) => Number(row.totalDispensed))).toEqual([3]);
    expect(ids(body.slowMoving)).toEqual(["LAB-000001"]); // MB-000002 is B's slow mover
    expect(body.insights.every((row: { itemId: string }) => !row.itemId.startsWith("MB-"))).toBe(true);
    expect(body.insights.map((row: { itemId: string }) => row.itemId)).toContain("A-000002");
    expect(ids(body.expiryRisks)).toEqual(["A-000002", "LAB-000001"]);
    // expDate must reach the client as a plain YYYY-MM-DD string and daysUntilExpiry must follow the seeded CURRENT_DATE + N.
    const daysByItem = Object.fromEntries(
      body.expiryRisks.map((row: { itemId: string; expDate: unknown; daysUntilExpiry: number }) => {
        expect(typeof row.expDate).toBe("string");
        expect(row.expDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        return [row.itemId, row.daysUntilExpiry];
      })
    );
    expect(daysByItem["A-000002"]).toBeGreaterThanOrEqual(19);
    expect(daysByItem["A-000002"]).toBeLessThanOrEqual(20);
    expect(daysByItem["LAB-000001"]).toBeGreaterThanOrEqual(9);
    expect(daysByItem["LAB-000001"]).toBeLessThanOrEqual(10);
  });

  it("room B sees only its own data", async () => {
    as("admin1", "Admin", DEPT_B);
    const body = await bodyOf(await usage());

    expect(ids(body.summary)).toEqual(["MB-000001", "MB-000002"]);
    expect(body.summary[0]).toMatchObject({ dispensed: 2, received: 0 });
    expect(Object.keys(body.dailyStats[0].items)).toEqual(["MB-000001"]);
    expect(body.weeklyStats.map((row: { totalDispensed: string }) => Number(row.totalDispensed))).toEqual([2]);
    expect(ids(body.slowMoving)).toEqual(["MB-000002"]);
    expect(body.insights.map((row: { itemId: string }) => row.itemId).sort()).toEqual(["MB-000001", "MB-000002"]);
    expect(ids(body.expiryRisks)).toEqual(["MB-000001", "MB-000002"]);
    expect(body.insights.find((row: { itemId: string }) => row.itemId === "MB-000001").dispensedLast90Days).toBe(2);
  });

  it("a non-staff user in room B only gets the scoped summary", async () => {
    as("solo2", "User", DEPT_B);
    const body = await bodyOf(await usage());
    expect(Object.keys(body)).toEqual(["summary"]);
    expect(ids(body.summary)).toEqual(["MB-000001", "MB-000002"]);
  });

  it("Admin viewing ALL rooms reads everything", async () => {
    as("admin1", "Admin", "ALL");
    const body = await bodyOf(await usage());
    expect(ids(body.summary)).toEqual(["A-000002", "MB-000001", "MB-000002"]);
    expect(ids(body.slowMoving)).toEqual(["LAB-000001", "MB-000002"]);
    expect(ids(body.expiryRisks)).toEqual(["A-000002", "LAB-000001", "MB-000001", "MB-000002"]);
  });

  it("a user who asked for a department they are not in gets 404", async () => {
    as("admin1", "Admin", DEPT_A, { departmentDenied: true });
    expect((await usage()).status).toBe(404);
  });

  it("answers 401 without a user and 400 for bad dates", async () => {
    h.user = null;
    expect((await usage()).status).toBe(401);
    as("admin1", "Admin", DEPT_A);
    expect((await usageGet(new Request("http://localhost/api/usage?startDate=x&endDate=y"))).status).toBe(400);
  });
});

describe("GET /api/logs", () => {
  it("room A reads only its own logs; ALL reads every room", async () => {
    as("admin1", "Admin", DEPT_A);
    const own = (await (await logsGet(new Request("http://localhost/api/logs?limit=50"))).json()) as Array<{ itemId: string }>;
    expect(own.map((row) => row.itemId).sort()).toEqual(["A-000002", "A-000002"]);

    as("admin1", "Admin", DEPT_B);
    const other = (await (await logsGet(new Request("http://localhost/api/logs?limit=50"))).json()) as Array<{ itemId: string }>;
    expect(other.map((row) => row.itemId).sort()).toEqual(["MB-000001", "MB-000002"]);

    as("admin1", "Admin", "ALL");
    const all = (await (await logsGet(new Request("http://localhost/api/logs?limit=50"))).json()) as unknown[];
    expect(all).toHaveLength(4);
  });

  it("the department filter is not defeated by the search OR group", async () => {
    as("admin1", "Admin", DEPT_A);
    // "Dept" matches names in both rooms; only room A's rows may come back.
    const rows = (await (await logsGet(new Request("http://localhost/api/logs?search=Dept&limit=50"))).json()) as Array<{ itemId: string }>;
    expect(rows.map((row) => row.itemId)).toEqual(["A-000002", "A-000002"]);
  });

  it("departmentDenied answers 404", async () => {
    as("admin1", "Admin", DEPT_A, { departmentDenied: true });
    expect((await logsGet(new Request("http://localhost/api/logs"))).status).toBe(404);
  });
});

describe("getReagentUsageInsights scope argument", () => {
  it("rejects a missing or wrong scope instead of failing open", async () => {
    const bad = [undefined, 5, "all", { username: "admin1", role: "Admin", scope: DEPT_A }, { mode: "one" }, { mode: "one", departmentId: "1" }, { mode: "everything" }];
    for (const value of bad) {
      await expect(getReagentUsageInsights(value as never)).rejects.toThrow("requires a DepartmentScope");
    }
    const ok = await getReagentUsageInsights({ mode: "one", departmentId: DEPT_B });
    expect(ok.insights.every((row) => row.itemId.startsWith("MB-"))).toBe(true);
  });
});

describe("GET /api/notifications/reorder-risk (cron)", () => {
  it("with the cron secret it still looks at every department (system-wide, unchanged)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    try {
      h.user = null; // cron has no user
      const response = await reorderRiskGet(new Request("http://localhost/api/notifications/reorder-risk", { headers: { authorization: "Bearer s3cret" } }));
      expect(response.status).toBe(200);
      expect(h.notifyUsers).toHaveBeenCalledTimes(1);
      const items = h.notifyUsers.mock.calls[0][1] as Array<{ itemId: string }>;
      expect(items.map((item) => item.itemId).sort()).toEqual(expect.arrayContaining(["A-000002", "MB-000001"]));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("flag OFF (legacy): unchanged and never mentions department_id", () => {
  it("every statement the usage, logs and reorder-risk routes send is free of department_id", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    const record = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = db(strings, ...values);
        seenSql.push(query.text);
        return query;
      },
      { unsafe: (text: string) => db.unsafe(text), transaction: (queries: never) => db.transaction(queries) },
    );
    h.target = record as unknown as Impl;
    as("admin1", "Admin", null);

    const body = await bodyOf(await usage());
    expect(ids(body.summary)).toEqual(["A-000002", "MB-000001", "MB-000002"]); // both rooms: no filtering when departments are off
    expect(ids(body.slowMoving)).toEqual(["LAB-000001", "MB-000002"]);
    expect((await logsGet(new Request("http://localhost/api/logs"))).status).toBe(200);
    expect((await getReagentUsageInsights({ mode: "legacy" })).insights.length).toBeGreaterThan(0);
    vi.stubEnv("CRON_SECRET", "s3cret");
    try {
      h.user = null;
      expect((await reorderRiskGet(new Request("http://localhost/api/notifications/reorder-risk", { headers: { authorization: "Bearer s3cret" } }))).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(seenSql.length).toBeGreaterThan(8);
    expect(seenSql.filter((text) => /department_id/i.test(text))).toEqual([]);
  });
});
