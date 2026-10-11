import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of the reconcile route on the production schema + v30-v34 (PGlite).

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { POST } from "./route";

const sql = dbSql as unknown as PgliteSql;
const managerB = { username: "managerb", name: "Manager B", role: "Manager", scope: DEPT_B };

beforeAll(async () => {
  await seedTwoDepartments(sql);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

// Department A owns A-000002 (lot LA1, id 201); department B owns MB-000001 (lot LB1, id 202).
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(managerB);
  await sql.db.exec(`
    DELETE FROM logs;
    DELETE FROM inventory;
    INSERT INTO inventory (id, item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      (201, 'A-000002', 'LA1', '2027-01-01', 10, '2026-09-01', ${DEPT_A}),
      (202, 'MB-000001', 'LB1', '2027-01-01', 10, '2026-09-01', ${DEPT_B});
  `);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

function reconcile(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/inventory/reconcile", { method: "POST", body: JSON.stringify(body) }));
}
const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;
const lots = async () => (await rows<{ id: number; lot_no: string; quantity: string }>("SELECT id, lot_no, quantity FROM inventory ORDER BY id"))
  .map((row) => `${row.id}/${row.lot_no}=${Number(row.quantity)}`);

const bBody = { inventoryId: 202, itemId: "MB-000001", newLotNo: "LB1-FIXED", newExpDate: "2028-01-01", newQty: 7 };

describe("reconcile route with a department scope", () => {
  it("fixes a row of the user's own department and logs the department", async () => {
    const response = await reconcile(bBody);

    expect(response.status).toBe(200);
    expect(await lots()).toEqual(["201/LA1=10", "202/LB1-FIXED=7"]);
    expect(await rows("SELECT department_id, item_id FROM logs")).toEqual([{ department_id: DEPT_B, item_id: "MB-000001" }]);
  });

  it("answers 404 for a row of another department and changes nothing", async () => {
    const response = await reconcile({ inventoryId: 201, itemId: "A-000002", newLotNo: "HACK", newExpDate: null, newQty: 1 });

    expect(response.status).toBe(404);
    expect(await lots()).toEqual(["201/LA1=10", "202/LB1=10"]);
    expect(await rows("SELECT 1 FROM logs")).toHaveLength(0);
  });

  it("answers 409 (not 500) when the new lot collides with a row of another department", async () => {
    // Inconsistent data on purpose: a department A row for B's item with the same received_on.
    await sql.db.exec(`INSERT INTO inventory (item_id, lot_no, quantity, received_on, department_id) VALUES ('MB-000001', 'CLASH', 1, '2026-09-01', ${DEPT_A})`);

    const response = await reconcile({ ...bBody, newLotNo: "CLASH" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("CLASH");
    expect((await lots())).toContain("202/LB1=10");
    expect(await rows("SELECT 1 FROM logs")).toHaveLength(0);
  });

  it("answers 409 DEPARTMENT_READ_ONLY in mode all before any write", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...managerB, scope: "ALL" });

    const response = await reconcile(bBody);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await lots()).toEqual(["201/LA1=10", "202/LB1=10"]);
  });

  it("answers 500 without the username when the user has no scope while departments are ready", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    resetDepartmentsFlagForTests();
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "secret.person", name: "Secret", role: "Manager" });

    const response = await reconcile(bBody);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret.person");
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
    expect(await lots()).toEqual(["201/LA1=10", "202/LB1=10"]);
  });
});
