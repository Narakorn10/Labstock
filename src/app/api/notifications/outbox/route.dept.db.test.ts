import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Notification outbox (drain, status report, retry) per department, against a real in-memory Postgres with the
// production schema + v30-v35. The precedence test matters most: the claim's WHERE is `(A) OR (B)` and the department
// filter must apply to BOTH branches (PENDING and stuck PROCESSING), not just the last one.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  user: null as null | Record<string, unknown>,
  sendLine: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: async () => h.user }));
vi.mock("@/lib/line-bot", () => ({ sendLinePushStrict: h.sendLine }));
vi.mock("@/lib/notifications", () => ({ sendEmailStrict: h.sendEmail }));

import { GET, POST } from "./route";
import { POST as retry } from "./[id]/route";
import { drainNotificationOutbox } from "@/lib/notification-outbox";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;
const seenSql: string[] = [];

const as = (username: string, role: string, scope: number | "ALL" | null, extra: Record<string, unknown> = {}) => {
  h.user = { username, name: username, role, scope, ...extra };
};
const url = "http://localhost/api/notifications/outbox";
const cron = { authorization: "Bearer s3cret" };
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const retryReq = (id: number) => retry(new Request(`${url}/${id}`, { method: "POST" }), ctx(id));
const rowOf = async (id: number) =>
  (await db.db.query<Record<string, unknown>>("SELECT * FROM notification_outbox WHERE id = $1", [id])).rows[0];
const sentTo = () => [...h.sendEmail.mock.calls.map((call) => call[0]), ...h.sendLine.mock.calls.map((call) => call[0])].sort();

let key = 0;
const insertRow = async (dept: number, address: string, status: string, opts: { channel?: string; ageMinutes?: number; future?: boolean } = {}) => {
  key += 1;
  const channel = opts.channel ?? "EMAIL";
  const locked = status === "PROCESSING";
  return Number(
    (
      await db.db.query<{ id: number }>(
        `INSERT INTO notification_outbox
           (event_type, recipient_username, recipient_role, channel, recipient_address, payload, idempotency_key, status,
            attempts, next_attempt_at, locked_at, locked_by, department_id)
         VALUES ('PO_SUBMITTED', 'someone', 'Admin', $1, $2, $3::jsonb, $4, $5, $6,
                 CASE WHEN $7::boolean THEN NOW() + INTERVAL '1 day' ELSE NOW() - INTERVAL '1 minute' END,
                 CASE WHEN $8::boolean THEN NOW() - ($9::int * INTERVAL '1 minute') ELSE NULL END,
                 CASE WHEN $8::boolean THEN 'old-worker' ELSE NULL END, $10)
         RETURNING id`,
        [
          channel, address,
          JSON.stringify({ po: { po_number: "PO-1", vendor: "V", status: "SUBMITTED" } }),
          `k-${key}`, status, status === "DEAD" ? 8 : 0, Boolean(opts.future), locked, opts.ageMinutes ?? 60, dept,
        ],
      )
    ).rows[0].id,
  );
};

const ids: Record<string, number> = {};

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(async () => {
  seenSql.length = 0;
  h.target = db as unknown as Impl;
  h.sendLine.mockReset().mockResolvedValue(undefined);
  h.sendEmail.mockReset().mockResolvedValue(undefined);
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  vi.stubEnv("CRON_SECRET", "s3cret");
  await db.db.exec("DELETE FROM notification_outbox");
  ids.pendA = await insertRow(DEPT_A, "a-pending@x.test", "PENDING");
  ids.stuckA = await insertRow(DEPT_A, "a-stuck@x.test", "PROCESSING");
  ids.futureA = await insertRow(DEPT_A, "a-future@x.test", "PENDING", { future: true });
  ids.deadA = await insertRow(DEPT_A, "a-dead@x.test", "DEAD");
  ids.pendB = await insertRow(DEPT_B, "b-pending@x.test", "PENDING");
  ids.stuckB = await insertRow(DEPT_B, "b-stuck@x.test", "PROCESSING");
  ids.lineB = await insertRow(DEPT_B, "b-line", "PENDING", { channel: "LINE" });
  ids.deadB = await insertRow(DEPT_B, "b-dead@x.test", "DEAD");
  ids.skippedB = await insertRow(DEPT_B, "b-skipped@x.test", "SKIPPED");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("drain claims (the OR precedence regression)", () => {
  it("staff in room A claim only room A's rows in BOTH branches (pending and stuck PROCESSING)", async () => {
    as("admin1", "Admin", DEPT_A);
    const response = await POST(new Request(url, { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, claimed: 2, delivered: 2, failed: 0 });
    expect(sentTo()).toEqual(["a-pending@x.test", "a-stuck@x.test"]);

    // Room B: untouched in the PENDING branch and in the stuck-PROCESSING branch.
    for (const id of [ids.pendB, ids.lineB]) {
      expect(await rowOf(id)).toMatchObject({ status: "PENDING", attempts: 0, locked_by: null });
    }
    expect(await rowOf(ids.stuckB)).toMatchObject({ status: "PROCESSING", attempts: 0, locked_by: "old-worker" });
    // Room A's future row is still not due.
    expect(await rowOf(ids.futureA)).toMatchObject({ status: "PENDING", attempts: 0 });
  });

  it("staff in room B claim only room B's rows in BOTH branches", async () => {
    as("admin1", "Admin", DEPT_B);
    const body = (await (await POST(new Request(url, { method: "POST" }))).json()) as { claimed: number };
    expect(body.claimed).toBe(3);
    expect(sentTo()).toEqual(["b-line", "b-pending@x.test", "b-stuck@x.test"]);
    expect(await rowOf(ids.pendA)).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(await rowOf(ids.stuckA)).toMatchObject({ status: "PROCESSING", attempts: 0, locked_by: "old-worker" });
  });

  it("cron (secret, no user) drains every department", async () => {
    h.user = null;
    const response = await GET(new Request(url, { headers: cron }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, claimed: 5, delivered: 5, failed: 0 });
    expect(sentTo()).toEqual(["a-pending@x.test", "a-stuck@x.test", "b-line", "b-pending@x.test", "b-stuck@x.test"]);
    expect((await POST(new Request(url, { method: "POST", headers: cron }))).status).toBe(200);
  });

  it("a global Admin viewing ALL rooms drains everything", async () => {
    as("admin1", "Admin", "ALL");
    const body = (await (await POST(new Request(url, { method: "POST" }))).json()) as { claimed: number };
    expect(body.claimed).toBe(5);
  });

  it("departmentDenied answers 404 and sends nothing", async () => {
    as("admin1", "Admin", DEPT_A, { departmentDenied: true });
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(404);
    expect((await GET(new Request(url))).status).toBe(404);
    expect(sentTo()).toEqual([]);
    expect(await rowOf(ids.pendA)).toMatchObject({ status: "PENDING", attempts: 0 });
  });

  it("rejects non-staff and a wrong secret with 401", async () => {
    as("solo1", "User", DEPT_A);
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(401);
    h.user = null;
    expect((await POST(new Request(url, { method: "POST", headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    expect(sentTo()).toEqual([]);
  });
});

describe("GET status report", () => {
  it("room A sees only its own counts", async () => {
    as("admin1", "Admin", DEPT_A);
    const body = (await (await GET(new Request(url))).json()) as { items: Array<{ status: string; count: number }> };
    expect(body.items.map((row) => [row.status, row.count])).toEqual([["DEAD", 1], ["PENDING", 2], ["PROCESSING", 1]]);
  });

  it("room B sees only its own counts and ALL sees the sum", async () => {
    as("admin1", "Admin", DEPT_B);
    let body = (await (await GET(new Request(url))).json()) as { items: Array<{ status: string; count: number }> };
    expect(body.items.map((row) => [row.status, row.count])).toEqual([["DEAD", 1], ["PENDING", 2], ["PROCESSING", 1], ["SKIPPED", 1]]);
    as("admin1", "Admin", "ALL");
    body = (await (await GET(new Request(url))).json()) as { items: Array<{ status: string; count: number }> };
    expect(body.items.map((row) => [row.status, row.count])).toEqual([["DEAD", 2], ["PENDING", 4], ["PROCESSING", 2], ["SKIPPED", 1]]);
  });
});

describe("POST /api/notifications/outbox/[id] (retry)", () => {
  it("room A can retry its own dead row", async () => {
    as("admin1", "Admin", DEPT_A);
    const response = await retryReq(ids.deadA);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, item: { id: ids.deadA, status: "PENDING" } });
    expect(await rowOf(ids.deadA)).toMatchObject({ status: "PENDING", attempts: 0 });
  });

  it("room A cannot retry room B's row: same 404 as a missing row, row unchanged", async () => {
    as("admin1", "Admin", DEPT_A);
    const before = await rowOf(ids.deadB);
    for (const id of [ids.deadB, ids.skippedB]) {
      const response = await retryReq(id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Outbox item not found or is not retryable" });
    }
    expect((await retryReq(999999)).status).toBe(404);
    expect(await rowOf(ids.deadB)).toEqual(before);
    expect(await rowOf(ids.skippedB)).toMatchObject({ status: "SKIPPED" });
  });

  it("Admin viewing ALL rooms cannot retry (409 DEPARTMENT_READ_ONLY) and nothing changes", async () => {
    as("admin1", "Admin", "ALL");
    const response = await retryReq(ids.deadA);
    expect(response.status).toBe(409);
    expect(await rowOf(ids.deadA)).toMatchObject({ status: "DEAD", attempts: 8 });
    expect(await rowOf(ids.deadB)).toMatchObject({ status: "DEAD", attempts: 8 });
  });

  it("departmentDenied answers 404, non-staff 401", async () => {
    as("admin1", "Admin", DEPT_A, { departmentDenied: true });
    expect((await retryReq(ids.deadA)).status).toBe(404);
    expect(await rowOf(ids.deadA)).toMatchObject({ status: "DEAD" });
    as("solo1", "User", DEPT_A);
    expect((await retryReq(ids.deadA)).status).toBe(401);
  });
});

describe("drainNotificationOutbox scope argument", () => {
  it("rejects a missing or wrong scope and claims nothing", async () => {
    const bad = [undefined, 5, "all", { username: "admin1", role: "Admin", scope: DEPT_A }, { mode: "one" }, { mode: "one", departmentId: "1" }, { mode: "everything" }];
    for (const value of bad) {
      await expect(drainNotificationOutbox(10, value as never)).rejects.toThrow("requires a DepartmentScope");
    }
    expect(sentTo()).toEqual([]);
    expect(await rowOf(ids.pendA)).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(await rowOf(ids.pendB)).toMatchObject({ status: "PENDING", attempts: 0 });
  });

  it("honours the limit within the scope", async () => {
    const result = await drainNotificationOutbox(1, { mode: "one", departmentId: DEPT_B });
    expect(result.claimed).toBe(1);
    expect(sentTo()).toHaveLength(1);
    expect(sentTo()[0]).toMatch(/^b-/);
  });
});

describe("flag OFF (legacy): unchanged and never mentions department_id", () => {
  it("every statement the outbox routes send is free of department_id", async () => {
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
    expect((await GET(new Request(url))).status).toBe(200);
    expect((await retryReq(ids.deadA)).status).toBe(200);
    const drained = (await (await POST(new Request(url, { method: "POST" }))).json()) as { claimed: number };
    expect(drained.claimed).toBeGreaterThan(5); // no filtering: both rooms (plus the retried row)
    h.user = null;
    expect((await GET(new Request(url, { headers: cron }))).status).toBe(200);

    expect(seenSql.length).toBeGreaterThan(5);
    expect(seenSql.filter((text) => /department_id/i.test(text))).toEqual([]);
  });
});
