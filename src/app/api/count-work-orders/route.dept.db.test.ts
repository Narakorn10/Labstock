import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of the count work-order routes on the production schema + v30-v34 (PGlite).

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

const sql = dbSql as unknown as PgliteSql;
const ownerB = { username: "ownerb", name: "Owner B", role: "User", scope: DEPT_B };

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await sql.db.exec(`
    CREATE TABLE count_work_order_items (
      id BIGSERIAL PRIMARY KEY, work_order_id BIGINT NOT NULL REFERENCES count_work_orders(id), item_id TEXT NOT NULL, name TEXT, unit TEXT,
      weekly_target NUMERIC, counted_qty NUMERIC, required_qty NUMERIC, revision INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (work_order_id, item_id));
    CREATE TABLE count_work_order_allocations (
      id BIGSERIAL PRIMARY KEY, work_order_item_id BIGINT NOT NULL, inventory_id BIGINT NOT NULL, qty NUMERIC NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (work_order_item_id, inventory_id));
    CREATE TABLE count_work_order_audit (
      id BIGSERIAL PRIMARY KEY, work_order_id BIGINT, work_order_item_id BIGINT, action TEXT, actor_username TEXT, after_data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
    UPDATE master_data SET weekly_target = 10, job_type = 'Routine' WHERE item_id IN ('A-000002', 'MB-000001', 'MB-000002');
  `);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(ownerB);
  await sql.db.exec("TRUNCATE count_work_order_audit, count_work_order_allocations, count_work_order_items, count_work_orders RESTART IDENTITY CASCADE");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const save = (items: Array<{ itemId: string; countedQty: number }>) =>
  POST(new Request("http://localhost/api/count-work-orders", json({ jobType: "Routine", items })));
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const patch = (id: number, items: Array<{ itemId: string; countedQty: number }>) =>
  PATCH(new Request(`http://localhost/api/count-work-orders/${id}`, { method: "PATCH", body: JSON.stringify({ items }) }), ctx(id));
const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;

describe("count work-order routes with a department scope", () => {
  it("POST creates the order in the user's department", async () => {
    const response = await save([{ itemId: "MB-000001", countedQty: 4 }]);

    expect(response.status).toBe(201);
    expect(await rows("SELECT department_id FROM count_work_orders")).toEqual([{ department_id: DEPT_B }]);
  });

  it("POST answers 409 ITEM_NOT_IN_DEPARTMENT for an item of another department", async () => {
    const response = await save([{ itemId: "A-000002", countedQty: 4 }]);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("ITEM_NOT_IN_DEPARTMENT");
    expect(await rows("SELECT 1 FROM count_work_orders")).toHaveLength(0);
  });

  it("POST answers 409 DEPARTMENT_READ_ONLY in mode all", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...ownerB, scope: "ALL" });

    const response = await save([{ itemId: "MB-000001", countedQty: 4 }]);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await rows("SELECT 1 FROM count_work_orders")).toHaveLength(0);
  });

  it("PATCH edits an own OPEN order with the same scope; DELETE cancels it", async () => {
    const created = await (await save([{ itemId: "MB-000001", countedQty: 4 }])).json();

    const edited = await patch(created.id, [{ itemId: "MB-000001", countedQty: 8 }]);
    expect(edited.status).toBe(200);
    expect(await rows("SELECT required_qty FROM count_work_order_items")).toEqual([{ required_qty: "2" }]);

    const cancelled = await DELETE(new Request(`http://localhost/api/count-work-orders/${created.id}`, { method: "DELETE" }), ctx(created.id));
    expect(cancelled.status).toBe(200);
    expect(await rows("SELECT status FROM count_work_orders")).toEqual([{ status: "CANCELLED" }]);
  });

  it("PATCH and GET do not find an order of another department", async () => {
    const created = await (await save([{ itemId: "MB-000001", countedQty: 4 }])).json();
    mocks.getAuthenticatedUser.mockResolvedValue({ ...ownerB, scope: DEPT_A });

    expect((await patch(created.id, [{ itemId: "A-000002", countedQty: 8 }])).status).toBe(403);
    const list = await (await GET(new Request("http://localhost/api/count-work-orders"))).json();
    expect(list).toEqual([]);
  });

  it("GET answers 500 without the username when the user has no scope while departments are ready", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    resetDepartmentsFlagForTests();
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "secret.person", name: "Secret", role: "User" });

    const response = await GET(new Request("http://localhost/api/count-work-orders"));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret.person");
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
  });
});
