import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of the reagent-loans route on the production schema + v30-v34 (PGlite).

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

const sql = dbSql as unknown as PgliteSql;
const staffB = { username: "staffb", name: "Staff B", role: "Operator", scope: DEPT_B };

beforeAll(async () => {
  await seedTwoDepartments(sql);
  // The production helper function (not part of the prod DDL used by the fixtures).
  await sql.db.exec(`
    CREATE FUNCTION labstock_assert(condition BOOLEAN, error_message TEXT) RETURNS BOOLEAN AS $$
    BEGIN
      IF condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%', error_message; END IF;
      RETURN TRUE;
    END;
    $$ LANGUAGE plpgsql;
  `);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

// Department A owns A-000002 (lot LA1, 10); department B owns MB-000001 (lot LB1, 10) and MB-000002.
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(staffB);
  await sql.db.exec(`
    DELETE FROM reagent_loans;
    DELETE FROM logs;
    DELETE FROM inventory;
    UPDATE master_data SET is_active = TRUE;
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('A-000002', 'LA1', '2027-01-01', 10, '2026-09-01', ${DEPT_A}),
      ('MB-000001', 'LB1', '2027-01-01', 10, '2026-09-01', ${DEPT_B});
    INSERT INTO reagent_loans (direction, partner_name, item_id, item_name, lot_no, quantity, created_by, department_id) VALUES
      ('LENT_OUT', 'Lab X', 'A-000002', 'Dept A extra item', 'LA1', 2, 'x', ${DEPT_A}),
      ('LENT_OUT', 'Lab Y', 'MB-000001', 'Dept B item 1', 'LB1', 3, 'x', ${DEPT_B});
  `);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

function post(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/reagent-loans", { method: "POST", body: JSON.stringify(body) }));
}
const get = () => GET(new Request("http://localhost/api/reagent-loans"));
const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;
const stock = async () => (await rows<{ item_id: string; lot_no: string; quantity: string; department_id: number }>(
  "SELECT item_id, lot_no, quantity, department_id FROM inventory ORDER BY id",
)).map((row) => `${row.item_id}/${row.lot_no}/d${row.department_id}=${Number(row.quantity)}`);
const noStockChange = [`A-000002/LA1/d${DEPT_A}=10`, `MB-000001/LB1/d${DEPT_B}=10`];

const borrowB = { operation: "BORROW_IN", partnerName: "Lab B", batchItems: [{ itemId: "MB-000001", lotNo: "LN", expDate: "2028-01-01", qty: 4 }] };

describe("reagent-loans GET with a department scope", () => {
  it("lists only the loans of the user's department", async () => {
    const body = await (await get()).json();

    expect(body.map((row: { item_id: string }) => row.item_id)).toEqual(["MB-000001"]);
  });

  it("lists every department in mode all", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...staffB, scope: "ALL" });

    const body = await (await get()).json();

    expect(body.map((row: { item_id: string }) => row.item_id).sort()).toEqual(["A-000002", "MB-000001"]);
  });

  it("answers 500 without the username when the user has no scope while departments are ready", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    resetDepartmentsFlagForTests();
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "secret.person", name: "Secret", role: "Operator" });

    const response = await get();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret.person");
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
  });
});

describe("reagent-loans POST with a department scope", () => {
  it("BORROW_IN writes the department on inventory, logs and the loan", async () => {
    const response = await post(borrowB);

    expect(response.status).toBe(200);
    expect(await stock()).toEqual([...noStockChange, `MB-000001/LN/d${DEPT_B}=4`]);
    expect(await rows("SELECT action, department_id FROM logs")).toEqual([{ action: "ยืมเข้าคลัง", department_id: DEPT_B }]);
    expect(await rows("SELECT department_id FROM reagent_loans WHERE partner_name = 'Lab B'")).toEqual([{ department_id: DEPT_B }]);
  });

  it("LEND_OUT reduces the department's stock and writes the department on the loan", async () => {
    const response = await post({ operation: "LEND_OUT", partnerName: "Lab B", batchItems: [{ itemId: "MB-000001", lotNo: "LB1", qty: 2 }] });

    expect(response.status).toBe(200);
    expect(await stock()).toEqual([`A-000002/LA1/d${DEPT_A}=10`, `MB-000001/LB1/d${DEPT_B}=8`]);
    expect(await rows("SELECT department_id FROM reagent_loans WHERE partner_name = 'Lab B'")).toEqual([{ department_id: DEPT_B }]);
  });

  it("answers 409 ITEM_NOT_IN_DEPARTMENT for an item of another department and writes nothing", async () => {
    const response = await post({ operation: "BORROW_IN", partnerName: "Lab B", batchItems: [{ itemId: "A-000002", lotNo: "LN", qty: 1 }] });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("ITEM_NOT_IN_DEPARTMENT");
    expect(body.error).toContain("A-000002");
    expect(await stock()).toEqual(noStockChange);
  });

  it("an inactive item of the own department still answers the legacy REAGENT_INACTIVE 409", async () => {
    await sql.db.exec("UPDATE master_data SET is_active = FALSE WHERE item_id = 'MB-000001'");

    const response = await post(borrowB);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("REAGENT_INACTIVE: MB-000001");
  });

  it("BORROW_IN refuses to merge into an inventory row of another department (409, nothing written)", async () => {
    // Inconsistent data on purpose: a department A row for B's item with today's received_on and the same lot.
    await sql.db.exec(`INSERT INTO inventory (item_id, lot_no, quantity, received_on, department_id) VALUES ('MB-000001', 'LN', 1, CURRENT_DATE, ${DEPT_A})`);

    const response = await post(borrowB);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ITEM_NOT_IN_DEPARTMENT");
    expect((await stock()).slice(-1)).toEqual([`MB-000001/LN/d${DEPT_A}=1`]);
    expect(await rows("SELECT 1 FROM logs")).toHaveLength(0);
    expect(await rows("SELECT 1 FROM reagent_loans WHERE partner_name = 'Lab B'")).toHaveLength(0);
  });

  it("LEND_OUT does not take stock from a lot owned by another department", async () => {
    await sql.db.exec(`INSERT INTO inventory (item_id, lot_no, quantity, received_on, department_id) VALUES ('MB-000002', 'LFOREIGN', 5, '2026-09-01', ${DEPT_A})`);

    const response = await post({ operation: "LEND_OUT", partnerName: "Lab B", batchItems: [{ itemId: "MB-000002", lotNo: "LFOREIGN", qty: 1 }] });

    expect(response.status).toBe(409);
    expect((await stock()).slice(-1)).toEqual([`MB-000002/LFOREIGN/d${DEPT_A}=5`]);
  });

  // Returns currently end in 500 for every scope (pre-existing SQL bug, see route.db.test.ts). The point here is that
  // mode one gives the same answer as legacy (not a success) and changes nothing.
  it("RETURN_IN with a loan of another department fails like legacy and changes nothing", async () => {
    const loan = (await rows<{ id: number }>(`SELECT id FROM reagent_loans WHERE department_id = ${DEPT_A}`))[0];

    const response = await post({ operation: "RETURN_IN", partnerName: "Lab X", batchItems: [{ itemId: "MB-000001", lotNo: "LB1", qty: 2, loanId: loan.id }] });

    expect(response.status).toBe(500);
    expect(await stock()).toEqual(noStockChange);
    expect(await rows("SELECT status FROM reagent_loans WHERE status = 'OPEN'")).toHaveLength(2);
  });

  it("answers 409 DEPARTMENT_READ_ONLY in mode all before any write", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...staffB, scope: "ALL" });

    const response = await post(borrowB);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await stock()).toEqual(noStockChange);
  });

  it("answers 500 without the username when the user has no scope while departments are ready", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    resetDepartmentsFlagForTests();
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "secret.person", name: "Secret", role: "Operator" });

    const response = await post(borrowB);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret.person");
    expect(await stock()).toEqual(noStockChange);
  });
});
