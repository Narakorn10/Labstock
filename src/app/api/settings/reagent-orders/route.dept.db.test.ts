import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Reagent order policies per room against a real (in-memory) Postgres with the production schema + v30-v35.
// reagent_order_policy has no department_id: a policy belongs to the room of its master_data row.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  user: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: async () => h.user }));

import { GET, PATCH, POST } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

const POLICY_SCHEMA = `
  CREATE TABLE reagent_order_policy (
    item_id TEXT PRIMARY KEY REFERENCES master_data(item_id) ON DELETE CASCADE,
    tests_per_box NUMERIC, avg_patient_tests_per_month NUMERIC NOT NULL DEFAULT 0, iqc_tests_per_month NUMERIC NOT NULL DEFAULT 0,
    documented_actual_withdrawal_boxes NUMERIC, source_verification_status TEXT NOT NULL DEFAULT 'NOT_AVAILABLE',
    approved_monthly_target_boxes NUMERIC, approved_order_qty_boxes NUMERIC, orders_per_month NUMERIC NOT NULL DEFAULT 2,
    lead_time_days INTEGER NOT NULL DEFAULT 7, safety_stock_boxes NUMERIC, min_order_qty_boxes INTEGER NOT NULL DEFAULT 1,
    order_multiple_boxes INTEGER NOT NULL DEFAULT 1, review_days INTEGER NOT NULL DEFAULT 15,
    enabled BOOLEAN NOT NULL DEFAULT true, reason TEXT, revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
  );
  CREATE TABLE reagent_order_policy_history (
    id BIGSERIAL PRIMARY KEY, item_id TEXT NOT NULL REFERENCES reagent_order_policy(item_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, before_state JSONB NOT NULL DEFAULT '{}'::jsonb, after_state JSONB NOT NULL,
    changed_by TEXT, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reason TEXT
  );
`;

const ITEM_A = "A-000002"; // room A (CC)
const ITEM_B = "MB-000001"; // room B (MB)

const payload = (itemId: string, extra: Record<string, unknown> = {}) => ({
  item_id: itemId, expected_revision: 1, tests_per_box: null, avg_patient_tests_per_month: 0, iqc_tests_per_month: 0,
  documented_actual_withdrawal_boxes: null, source_verification_status: "NEEDS_REVIEW", approved_monthly_target_boxes: 15,
  approved_order_qty_boxes: 8, orders_per_month: 2, lead_time_days: 7, safety_stock_boxes: 2, min_order_qty_boxes: 1,
  order_multiple_boxes: 1, review_days: 15, enabled: true, reason: "plan", change_reason: "reviewed", ...extra,
});
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/settings/reagent-orders", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const as = (username: string, role: string, scope: number | "ALL" | null) => {
  h.user = { username, name: username, role, scope };
};
const policyItems = async () => (await db.db.query<{ item_id: string }>("SELECT item_id FROM reagent_order_policy ORDER BY item_id")).rows.map((r) => r.item_id);

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
  await db.db.exec(POLICY_SCHEMA);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(async () => {
  h.target = db as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await db.db.exec(`
    DELETE FROM reagent_order_policy;
    UPDATE user_departments SET admin_slot = NULL;
    INSERT INTO reagent_order_policy (item_id, reason) VALUES ('${ITEM_A}', 'seed A');
  `);
  if (!process.env.SHOW_ERR) vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("flag OFF (legacy): unchanged", () => {
  it("a Manager sees the items of every room and can create a policy for any of them", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    as("manager", "Manager", null);
    const list = await (await GET(req("GET")))!.json();
    expect(list.data.map((row: { item_id: string }) => row.item_id)).toEqual(expect.arrayContaining([ITEM_A, ITEM_B]));
    expect((await POST(req("POST", payload(ITEM_B, { expected_revision: 0 }))))!.status).toBe(201);
  });
});

describe("flag ON, scope = room B", () => {
  it("GET lists only room B items", async () => {
    as("manager", "Manager", DEPT_B);
    const list = await (await GET(req("GET")))!.json();
    const ids = list.data.map((row: { item_id: string }) => row.item_id);
    expect(ids).toEqual(expect.arrayContaining([ITEM_B]));
    expect(ids).not.toContain(ITEM_A);
  });

  it("creates a policy for a room B item but answers 409 for a room A item (nothing is written)", async () => {
    as("manager", "Manager", DEPT_B);
    expect((await POST(req("POST", payload(ITEM_B, { expected_revision: 0 }))))!.status).toBe(201);
    const denied = await POST(req("POST", payload("LAB-000001", { expected_revision: 0 })));
    expect(denied!.status).toBe(409);
    expect(await policyItems()).toEqual([ITEM_A, ITEM_B].sort());
  });

  it("updates a room B policy but cannot touch the policy of a room A item", async () => {
    await db.db.exec(`INSERT INTO reagent_order_policy (item_id, reason) VALUES ('${ITEM_B}', 'seed B')`);
    as("manager", "Manager", DEPT_B);
    expect((await PATCH(req("PATCH", payload(ITEM_B))))!.status).toBe(200);
    expect((await PATCH(req("PATCH", payload(ITEM_A, { reason: "hijack" }))))!.status).toBe(409);
    const reason = (await db.db.query<{ reason: string }>(`SELECT reason FROM reagent_order_policy WHERE item_id = '${ITEM_A}'`)).rows[0].reason;
    expect(reason).toBe("seed A");
  });

  it("Admin viewing ALL rooms can read everything but cannot write (409 read-only)", async () => {
    as("admin1", "Admin", "ALL");
    const list = await (await GET(req("GET")))!.json();
    expect(list.data.map((row: { item_id: string }) => row.item_id)).toEqual(expect.arrayContaining([ITEM_A, ITEM_B]));
    const response = await PATCH(req("PATCH", payload(ITEM_A)));
    expect(response!.status).toBe(409);
    expect((await response!.json()).code).toBe("DEPARTMENT_READ_ONLY");
  });

  it("a user who asked for a room they are not in gets 404", async () => {
    h.user = { username: "manager", name: "m", role: "Manager", scope: DEPT_B, departmentDenied: true };
    expect((await GET(req("GET")))!.status).toBe(404);
  });
});

describe("room admin", () => {
  it("a room admin of room B can manage room B policies; an ordinary member cannot", async () => {
    await db.db.exec(`INSERT INTO reagent_order_policy (item_id, reason) VALUES ('${ITEM_B}', 'seed B')`);
    await db.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo2' AND department_id = ${DEPT_B}`);
    as("solo2", "User", DEPT_B);
    expect((await PATCH(req("PATCH", payload(ITEM_B))))!.status).toBe(200);
    expect((await PATCH(req("PATCH", payload(ITEM_A))))!.status).toBe(409);

    await db.db.exec(`UPDATE user_departments SET admin_slot = NULL`);
    expect((await PATCH(req("PATCH", payload(ITEM_B))))!.status).toBe(403);
  });

  it("an admin slot in room B gives nothing while working in room A", async () => {
    await db.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'user1' AND department_id = ${DEPT_B}`);
    as("user1", "User", DEPT_A);
    expect((await GET(req("GET")))!.status).toBe(403);
    as("user1", "User", DEPT_B);
    expect((await GET(req("GET")))!.status).toBe(200);
  });
});
