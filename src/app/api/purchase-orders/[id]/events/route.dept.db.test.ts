import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// G5 PR-3: GET /api/purchase-orders/[id]/events by department on the production schema + v30-v35 (PGlite).
const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import dbSql from "@/lib/db";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder } from "@/test/purchase-order-dept-fixtures";
import { GET } from "./route";

const sql = dbSql as unknown as PgliteSql;
const labA = { username: "mgrA", name: "Mgr A", role: "Manager", scope: DEPT_A };
const labB = { username: "mgrB", name: "Mgr B", role: "Manager", scope: DEPT_B };
const adminAll = { username: "admin1", name: "Admin", role: "Admin", scope: "ALL" };
const vendorPcl = { username: "vendorP", name: "V", role: "Vendor", vendor: "PCL", scope: DEPT_A };
const vendorOther = { username: "vendorO", name: "V", role: "Vendor", vendor: "OTHER", scope: DEPT_A };
let poA: number;
let poB: number;

const get = (id: number | string) =>
  GET(new Request(`http://localhost/api/purchase-orders/${id}/events`), { params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
  await sql.db.exec(`
    ALTER TABLE purchase_order_events
      ADD COLUMN from_status TEXT, ADD COLUMN to_status TEXT, ADD COLUMN actor_username TEXT, ADD COLUMN actor_role TEXT,
      ADD COLUMN source TEXT NOT NULL DEFAULT 'WEB', ADD COLUMN visibility TEXT NOT NULL DEFAULT 'BOTH',
      ADD COLUMN note TEXT, ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(labA);
  await sql.db.exec("TRUNCATE purchase_order_events, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE");
  poA = (await insertPurchaseOrder(sql, { poNumber: "PO-A", departmentId: DEPT_A, status: "SUBMITTED", vendor: "PCL" })).poId;
  poB = (await insertPurchaseOrder(sql, { poNumber: "PO-B", departmentId: DEPT_B, status: "SUBMITTED", vendor: "PCL" })).poId;
  await sql.db.exec(`
    INSERT INTO purchase_order_events (po_id, po_number, event_type) VALUES
      (${poA}, 'PO-A', 'PO_CREATED'), (${poB}, 'PO-B', 'PO_CREATED');
  `);
});

describe("GET /api/purchase-orders/[id]/events", () => {
  it("a Lab user reads the timeline of a PO in their own department", async () => {
    const response = await get(poA);

    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([expect.objectContaining({ po_number: "PO-A", event_type: "PO_CREATED" })]);
  });

  it("another department's PO is 404 (not 403), and the same id is readable from its own department", async () => {
    expect((await get(poB)).status).toBe(404);

    mocks.getAuthenticatedUser.mockResolvedValue(labB);
    expect((await get(poB)).status).toBe(200);
    expect((await get(poA)).status).toBe(404);
  });

  it("an Admin viewing all departments sees both", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);

    expect((await get(poA)).status).toBe(200);
    expect((await get(poB)).status).toBe(200);
  });

  it("a Vendor reads the timeline of their own company's PO (not filtered by department); another company is 403", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(vendorPcl);
    expect((await get(poB)).status).toBe(200);
    expect((await get(poA)).status).toBe(200);

    mocks.getAuthenticatedUser.mockResolvedValue(vendorOther);
    expect((await get(poB)).status).toBe(403);
  });

  it("a user who asked for a department they are not in gets 404, not 500", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...labA, departmentDenied: true });

    expect((await get(poA)).status).toBe(404);
  });

  it("keeps the existing 401 / 403 / 400 answers", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    expect((await get(poA)).status).toBe(401);
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "u", name: "U", role: "User", scope: DEPT_A });
    expect((await get(poA)).status).toBe(403);
    mocks.getAuthenticatedUser.mockResolvedValue(labA);
    expect((await get("abc")).status).toBe(400);
  });
});
