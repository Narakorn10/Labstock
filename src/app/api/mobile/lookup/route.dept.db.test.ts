import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { PgliteSql } from "@/test/pglite-sql";

// Department behaviour of the mobile lookup route on the production schema + v30-v35 (PGlite).

const mocks = vi.hoisted(() => ({ authenticateMobileLookup: vi.fn() }));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/mobile-lookup-auth", () => ({ authenticateMobileLookup: mocks.authenticateMobileLookup }));

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { GET } from "./route";

const sql = dbSql as unknown as PgliteSql;
const userB = { username: "secret.userb", name: "User B", role: "Operator", scope: DEPT_B };
const userA = { username: "secret.usera", name: "User A", role: "Operator", scope: DEPT_A };

beforeAll(async () => {
  await seedTwoDepartments(sql);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.authenticateMobileLookup.mockReset();
  mocks.authenticateMobileLookup.mockResolvedValue({ ok: true, user: userB });
  await sql.db.exec(`
    DELETE FROM inventory;
    UPDATE master_data SET is_active = TRUE;
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('A-000002', 'LA1', '2027-01-01', 10, '2026-09-01', ${DEPT_A}),
      ('MB-000001', 'LB1', '2027-01-01', 7, '2026-09-01', ${DEPT_B});
  `);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

const get = () => GET(new Request("http://localhost/api/mobile/lookup"));
const ids = (body: { reagents: Array<{ itemId: string }> }) => body.reagents.map((r) => r.itemId);

describe("mobile lookup with a department scope", () => {
  it("auth failure response is returned untouched and no query runs", async () => {
    const querySpy = vi.spyOn(sql.db, "query");
    mocks.authenticateMobileLookup.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Please sign in." }, { status: 401 }),
    });

    const response = await get();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Please sign in." });
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("department B user sees only B items and B lots", async () => {
    const body = await (await get()).json();

    expect(ids(body).sort()).toEqual(["MB-000001", "MB-000002"]);
    const item = body.reagents.find((r: { itemId: string }) => r.itemId === "MB-000001");
    expect(item.quantity).toBe(7);
    expect(item.lots.map((l: { lotNo: string }) => l.lotNo)).toEqual(["LB1"]);
  });

  it("department A user sees only A items", async () => {
    mocks.authenticateMobileLookup.mockResolvedValue({ ok: true, user: userA });

    const body = await (await get()).json();

    expect(ids(body)).not.toContain("MB-000001");
    expect(ids(body)).not.toContain("MB-000002");
    expect(ids(body)).toContain("A-000002");
  });

  it("every returned lot belongs to the caller's department", async () => {
    const body = await (await get()).json();
    const returnedIds = body.reagents.flatMap((r: { lots: Array<{ inventoryId: number }> }) => r.lots.map((l) => l.inventoryId));
    expect(returnedIds.length).toBeGreaterThan(0);

    const rows = (await sql.db.query<{ department_id: number }>(
      `SELECT department_id FROM inventory WHERE id = ANY($1::int[])`,
      [returnedIds],
    )).rows;

    expect(rows.map((r) => r.department_id)).toEqual(rows.map(() => DEPT_B));
  });

  it("an A-owned lot attached to a B item is not shown to B", async () => {
    await sql.db.exec(`INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES ('MB-000001', 'LFOREIGN', '2027-01-01', 5, '2026-09-01', ${DEPT_A})`);

    const body = await (await get()).json();
    const item = body.reagents.find((r: { itemId: string }) => r.itemId === "MB-000001");

    expect(item.lots.map((l: { lotNo: string }) => l.lotNo)).toEqual(["LB1"]);
    expect(item.quantity).toBe(7);
  });

  it("flag off, user without scope: all items are returned", async () => {
    mocks.authenticateMobileLookup.mockResolvedValue({ ok: true, user: { username: "legacy", name: "Legacy", role: "Operator" } });

    const body = await (await get()).json();

    expect(ids(body)).toEqual(expect.arrayContaining(["A-000002", "MB-000001", "MB-000002"]));
  });

  it("a user with scope ALL gets 500 and no data", async () => {
    mocks.authenticateMobileLookup.mockResolvedValue({ ok: true, user: { ...userB, scope: "ALL" } });

    const response = await get();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "Unable to load stock data." });
    expect(text).not.toContain("MB-000001");
    expect(text).not.toContain("secret.userb");
  });

  it("flag on but user without scope gives 500 and no username in the body", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    mocks.authenticateMobileLookup.mockResolvedValue({ ok: true, user: { username: "secret.noscope", name: "No Scope", role: "Operator" } });

    const response = await get();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret.noscope");
    expect(text).not.toContain("MB-000001");
  });

  it("500 body contains no username or SQL text", async () => {
    vi.spyOn(sql.db, "query").mockRejectedValue(new Error('relation "master_data" does not exist for secret.userb'));

    const response = await get();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "Unable to load stock data." });
    expect(text).not.toContain("secret.userb");
    expect(text).not.toContain("master_data");
  });

  it("response keeps reagents, patterns, v2Patterns, engineVersion and has Cache-Control no-store", async () => {
    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Array.isArray(body.reagents)).toBe(true);
    expect(Array.isArray(body.patterns)).toBe(true);
    expect(Array.isArray(body.v2Patterns)).toBe(true);
    expect(body).toHaveProperty("engineVersion");
  });
});
