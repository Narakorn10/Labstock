import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite, types } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";
import { COUNT_WORK_ORDER_CHILD_DDL } from "@/test/count-work-order-tables";

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
  await db.db.exec(COUNT_WORK_ORDER_CHILD_DDL);
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
    DELETE FROM count_work_order_audit WHERE work_order_id IN (SELECT id FROM count_work_orders WHERE owner_username = 'usage-refill-test');
    DELETE FROM count_work_order_allocations WHERE work_order_item_id IN (SELECT i.id FROM count_work_order_items i JOIN count_work_orders w ON w.id = i.work_order_id WHERE w.owner_username = 'usage-refill-test');
    DELETE FROM count_work_order_items WHERE work_order_id IN (SELECT id FROM count_work_orders WHERE owner_username = 'usage-refill-test');
    DELETE FROM count_work_orders WHERE owner_username = 'usage-refill-test';
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

  it("puts a dispense after midnight Thai time on the next day in dailyStats", async () => {
    as("admin1", "Admin", DEPT_A);
    try {
      // 2026-06-01 18:00Z = 2026-06-02 01:00 in Thailand.
      await db.db.exec(`
        INSERT INTO logs (timestamp, item_id, name, lot_no, action, quantity, username, department_id) VALUES
          ('2026-06-01 18:00+00', 'A-000002', 'Dept A extra item', 'LA1', '${DISPENSE}', 7, 'usage-tz-test', ${DEPT_A});
      `);
      const body = await bodyOf(await usage());
      const byDate = Object.fromEntries(body.dailyStats.map((row: { date: string; items: Record<string, number> }) => [row.date, row.items]));
      expect(byDate["2026-06-02"]).toEqual({ "A-000002": 7 });
      expect(byDate["2026-06-01"]).toBeUndefined();
    } finally {
      await db.db.exec(`DELETE FROM logs WHERE username = 'usage-tz-test'`);
    }
  });

  it("adds the count refill of the room's own items to summary and dailyStats (admin only)", async () => {
    // Room A counted A-000002 (refill 5) and LAB-000001 (refill 2, no dispensing at all); room B counted MB-000001 (refill 9).
    // Each count is the first of its item, saved 3 Nov 09:00 Thai time, so it spreads over 27 Oct - 2 Nov.
    const seedCount = async (departmentId: number, itemId: string, qty: number) => {
      await db.db.exec(`
        WITH o AS (INSERT INTO count_work_orders (owner_username, job_type, status, department_id) VALUES ('usage-refill-test', '', 'CONFIRMED', ${departmentId}) RETURNING id),
        i AS (INSERT INTO count_work_order_items (work_order_id, item_id, name, weekly_target, counted_qty, required_qty) SELECT id, '${itemId}', 'x', 10, 1, 0 FROM o RETURNING id, work_order_id),
        a AS (INSERT INTO count_work_order_allocations (work_order_item_id, inventory_id, qty) SELECT id, 1, ${qty} FROM i)
        INSERT INTO count_work_order_audit (work_order_id, work_order_item_id, action, actor_username, created_at)
        SELECT work_order_id, id, 'COUNT_SAVED', 'usage-refill-test', '2026-11-03 02:00+00' FROM i;
      `);
    };
    await seedCount(DEPT_A, "A-000002", 5);
    await seedCount(DEPT_A, "LAB-000001", 2);
    await seedCount(DEPT_B, "MB-000001", 9);

    as("admin1", "Admin", DEPT_A);
    const bodyA = await bodyOf(await usage());
    const rowA = (id: string) => bodyA.summary.find((row: { itemId: string }) => row.itemId === id);
    expect(rowA("A-000002")).toMatchObject({ dispensed: 3, refill: 5, usage: 8 });
    expect(rowA("LAB-000001")).toMatchObject({ dispensed: 0, refill: 2, usage: 2 }); // refill-only item still gets a row
    expect(ids(bodyA.summary)).toEqual(["A-000002", "LAB-000001"]);
    const refillByItem: Record<string, number> = {};
    let totalRefill = 0;
    for (const day of bodyA.dailyStats) {
      totalRefill += day.totalRefill ?? 0;
      for (const [id, qty] of Object.entries(day.itemsRefill ?? {})) refillByItem[id] = (refillByItem[id] ?? 0) + (qty as number);
    }
    expect(totalRefill).toBeCloseTo(7, 2);
    expect(refillByItem["A-000002"]).toBeCloseTo(5, 2);
    expect(refillByItem["LAB-000001"]).toBeCloseTo(2, 2);
    expect(JSON.stringify(bodyA)).not.toContain("MB-000001");
    const spread = bodyA.dailyStats.filter((day: { totalRefill?: number }) => day.totalRefill).map((day: { date: string }) => day.date);
    expect(spread[0]).toBe("2026-10-27");
    expect(spread.at(-1)).toBe("2026-11-02");

    as("admin1", "Admin", DEPT_B);
    const bodyB = await bodyOf(await usage());
    expect(bodyB.summary.find((row: { itemId: string }) => row.itemId === "MB-000001")).toMatchObject({ dispensed: 2, refill: 9, usage: 11 });
    expect(JSON.stringify(bodyB)).not.toContain("A-000002");
    expect(JSON.stringify(bodyB)).not.toContain("LAB-000001");

    // A non-staff user keeps the old summary: no refill fields at all.
    as("solo2", "User", DEPT_B);
    const plain = await bodyOf(await usage());
    expect(Object.keys(plain)).toEqual(["summary"]);
    expect(plain.summary.every((row: Record<string, unknown>) => !("refill" in row) && !("usage" in row))).toBe(true);
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

    expect(seenSql.some((text) => /count_work_order_items/.test(text))).toBe(true); // the refill query ran, without department_id
    expect(seenSql.length).toBeGreaterThan(8);
    expect(seenSql.filter((text) => /department_id/i.test(text))).toEqual([]);
  });
});
