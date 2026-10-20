import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// G5 PR-3: POST/GET /api/notifications/purchase-order-overdue by department, with the real overdue + communication code
// on the production schema + v30-v35 (PGlite). Callers carry their scope directly (as resolveUserDepartment would set it).
const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/feature-flags", () => ({ SHIPMENTS_ENABLED: false }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => { throw new Error("no request scope"); },
}));

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { GET, POST } from "./route";

const sql = dbSql as unknown as PgliteSql;
const CRON_SECRET = "test-cron-secret";
const managerA = { username: "mgrA", name: "Mgr A", role: "Manager", scope: DEPT_A };
const adminAll = { username: "adminAB", name: "Admin AB", role: "Admin", scope: "ALL" };

const call = (headers: Record<string, string> = {}, method: "POST" | "GET" = "POST") =>
  (method === "POST" ? POST : GET)(new Request("http://localhost/api/notifications/purchase-order-overdue", { method, headers }));
const eventPos = async () => (await sql.db.query<{ po_number: string }>("SELECT po_number FROM purchase_order_events ORDER BY po_number")).rows.map((row) => row.po_number);

beforeAll(async () => {
  process.env.CRON_SECRET = CRON_SECRET;
  await seedTwoDepartments(sql);
  await sql.db.exec(`
    CREATE TABLE purchase_order_items (
      id SERIAL PRIMARY KEY, po_id INT REFERENCES purchase_orders(id), item_id TEXT, item_name TEXT, quantity NUMERIC, unit TEXT
    );
    ALTER TABLE purchase_order_events
      ADD COLUMN from_status TEXT, ADD COLUMN to_status TEXT, ADD COLUMN actor_username TEXT, ADD COLUMN actor_role TEXT,
      ADD COLUMN source TEXT NOT NULL DEFAULT 'WEB', ADD COLUMN visibility TEXT NOT NULL DEFAULT 'BOTH',
      ADD COLUMN note TEXT, ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE notification_settings (
      username TEXT PRIMARY KEY, email TEXT, line_user_id TEXT,
      notify_po_created BOOLEAN, notify_po_confirmed BOOLEAN, notify_po_shipped BOOLEAN,
      notify_po_received BOOLEAN, notify_po_status_updates BOOLEAN
    );
    INSERT INTO users (username, password_hash, name, role) VALUES ('mgrA', 'x', 'Mgr A', 'Manager'), ('adminAB', 'x', 'Admin AB', 'Admin');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('mgrA', ${DEPT_A}, NULL, true), ('adminAB', ${DEPT_A}, NULL, true), ('adminAB', ${DEPT_B}, NULL, false);
    INSERT INTO notification_settings (username, email) VALUES ('mgrA', 'mgrA@lab.test'), ('adminAB', 'adminAB@lab.test');
  `);
}, 60_000);

afterAll(async () => {
  delete process.env.CRON_SECRET;
  resetDepartmentsFlagForTests();
  await sql.db.close();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(null);
  await sql.db.exec(`
    TRUNCATE purchase_order_events, notification_outbox, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;
    INSERT INTO purchase_orders (po_number, vendor, created_by, status, vendor_response_due_at, department_id) VALUES
      ('PO-A-LATE', 'PCL', 'seed', 'SUBMITTED', NOW() - INTERVAL '1 day', ${DEPT_A}),
      ('PO-B-LATE', 'PCL', 'seed', 'SUBMITTED', NOW() - INTERVAL '1 day', ${DEPT_B});
  `);
});

describe("purchase-order-overdue route", () => {
  it("a wrong cron secret and no login is 401 and records nothing", async () => {
    const response = await call({ "x-cron-secret": "wrong" });

    expect(response.status).toBe(401);
    expect(await eventPos()).toEqual([]);
  });

  it("the right cron secret (Bearer or header, POST or GET) reminds every department", async () => {
    const response = await call({ authorization: `Bearer ${CRON_SECRET}` }, "GET");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, reminded: 2 });
    expect(await eventPos()).toEqual(["PO-A-LATE", "PO-B-LATE"]);
  });

  it("a Manager of department A reminds only department A", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(managerA);
    const response = await call();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reminded: 1, orders: [{ po_number: "PO-A-LATE", event: "VENDOR_RESPONSE_OVERDUE" }] });
    expect(await eventPos()).toEqual(["PO-A-LATE"]);
  });

  it("a central Admin viewing all departments may trigger every department (same as the cron)", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    const response = await call();

    expect(response.status).toBe(200);
    expect(await eventPos()).toEqual(["PO-A-LATE", "PO-B-LATE"]);
  });

  it("a user who asked for a department they are not in gets 404, not 500, and nothing is recorded", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...managerA, departmentDenied: true });
    const response = await call();

    expect(response.status).toBe(404);
    expect(await eventPos()).toEqual([]);
  });

  it("a non-Lab role is 401", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "v", name: "V", role: "Vendor", scope: null });
    const response = await call();

    expect(response.status).toBe(401);
  });
});
