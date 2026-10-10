import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of runDispenseBatch on the real production schema + v30-v34 (PGlite).
// Receive / low-stock cases are added in later steps. One PGlite instance backs `@/lib/db`, so the SQL fragments
// built by scoped-db.ts and embedded in the transaction templates of stock-transactions.ts run on the same engine.
vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/notifications", () => ({
  notifyUsers: vi.fn(async () => undefined),
  notifyUsersVendorScoped: vi.fn(async () => undefined),
}));

import dbSql from "@/lib/db";
import { AppError } from "@/lib/errors";
import { toApiError } from "@/lib/api-response";
import { DepartmentScopeError, type DepartmentScope } from "@/lib/scoped-db";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { runDispenseBatch, runReceiveBatch } from "./stock-transactions";

const sql = dbSql as unknown as PgliteSql;
const userB = { username: "solo2", name: "Solo Two", role: "Technician" };
const audit = { userAgent: "test", ipAddress: "127.0.0.1" };
const ONE_B: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const ONE_A: DepartmentScope = { mode: "one", departmentId: DEPT_A };
const DISPENSE_ACTION = "เบิกไปหน้างาน";

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
    CREATE TABLE notification_settings (
      username TEXT PRIMARY KEY, email TEXT, line_user_id TEXT, notify_low_stock BOOLEAN DEFAULT FALSE
    );
  `);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

// Department A owns A-000002 (lot LA1, 10); department B owns MB-000001 (lot LB1, 10) and MB-000002 (lot LB2, 4).
beforeEach(async () => {
  vi.restoreAllMocks();
  await sql.db.exec(`
    DELETE FROM logs;
    DELETE FROM inventory;
    UPDATE master_data SET is_active = TRUE;
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('A-000002', 'LA1', '2027-01-01', 10, '2026-09-01', ${DEPT_A}),
      ('MB-000001', 'LB1', '2027-01-01', 10, '2026-09-01', ${DEPT_B}),
      ('MB-000002', 'LB2', '2027-01-01', 4, '2026-09-01', ${DEPT_B});
  `);
});

const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;
const stock = async () => (await rows<{ item_id: string; lot_no: string; quantity: string; department_id: number }>(
  "SELECT item_id, lot_no, quantity, department_id FROM inventory ORDER BY id",
)).map((row) => `${row.item_id}/${row.lot_no}/d${row.department_id}=${Number(row.quantity)}`);
const dispenseLogs = () => rows<{ item_id: string; quantity: string; department_id: number }>(
  `SELECT item_id, quantity, department_id FROM logs WHERE action = '${DISPENSE_ACTION}' ORDER BY id`,
);
const catchError = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

describe("runDispenseBatch with a department scope", () => {
  it("a) dispenses an item of the user's own department, decreases stock and logs the department", async () => {
    const result = await runDispenseBatch([{ itemId: "MB-000001", lotNo: "LB1", qty: 3 }], userB, audit, ONE_B);

    expect(result).toEqual({ success: true, message: "เบิกจ่ายสำเร็จ" });
    expect(await stock()).toEqual([`A-000002/LA1/d${DEPT_A}=10`, `MB-000001/LB1/d${DEPT_B}=7`, `MB-000002/LB2/d${DEPT_B}=4`]);
    const logs = await dispenseLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ item_id: "MB-000001", department_id: DEPT_B });
    expect(Number(logs[0].quantity)).toBe(3);
  });

  it("b) refuses an item of another department with ITEM_NOT_IN_DEPARTMENT (409, Thai, item id) and changes nothing", async () => {
    const before = await stock();
    const error = await catchError(runDispenseBatch([{ inventoryId: 1, itemId: "A-000002", lotNo: "LA1", qty: 2 }], userB, audit, ONE_B));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "ITEM_NOT_IN_DEPARTMENT" });
    expect(await stock()).toEqual(before);
    expect(await dispenseLogs()).toHaveLength(0);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { response } = toApiError(error, "req-1");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("รายการนี้ไม่อยู่ในงานของคุณ (A-000002)");
  });

  it("c) an item id that does not exist gets the same answer (no hint whether it exists elsewhere)", async () => {
    const before = await stock();
    const missing = await catchError(runDispenseBatch([{ itemId: "NOPE-1", lotNo: "L1", qty: 1 }], userB, audit, ONE_B));
    const otherDept = await catchError(runDispenseBatch([{ itemId: "A-000002", lotNo: "LA1", qty: 1 }], userB, audit, ONE_B));

    expect(missing).toMatchObject({ code: "ITEM_NOT_IN_DEPARTMENT", userMessage: "รายการนี้ไม่อยู่ในงานของคุณ (NOPE-1)" });
    expect(otherDept).toMatchObject({ code: "ITEM_NOT_IN_DEPARTMENT", userMessage: "รายการนี้ไม่อยู่ในงานของคุณ (A-000002)" });
    expect(await stock()).toEqual(before);
    expect(await dispenseLogs()).toHaveLength(0);
  });

  it("c2) item ids are matched case-insensitively like before", async () => {
    await runDispenseBatch([{ itemId: "mb-000001", lotNo: "LB1", qty: 1 }], userB, audit, ONE_B);
    expect((await stock())[1]).toBe(`MB-000001/LB1/d${DEPT_B}=9`);
  });

  it("d) an inventoryId pointing at another department's row is never touched; the user's own row of the lot is used", async () => {
    // X: data mismatch (item of department B but the row sits in department A). Y: the proper department B row.
    await sql.db.exec(`
      INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
        ('MB-000001', 'L1', '2027-01-01', 5, '2026-09-02', ${DEPT_A}),
        ('MB-000001', 'L1', '2027-01-01', 5, '2026-09-03', ${DEPT_B});
    `);
    const [x, y] = await rows<{ id: number }>("SELECT id FROM inventory WHERE lot_no = 'L1' ORDER BY id");

    await runDispenseBatch([{ inventoryId: x.id, itemId: "MB-000001", lotNo: "L1", qty: 2 }], userB, audit, ONE_B);

    const after = await rows<{ id: number; quantity: string }>("SELECT id, quantity FROM inventory WHERE lot_no = 'L1' ORDER BY id");
    expect(after.map((row) => [row.id, Number(row.quantity)])).toEqual([[x.id, 5], [y.id, 3]]);
    const logs = await dispenseLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ item_id: "MB-000001", department_id: DEPT_B });
  });

  it("d2) the same cart without a department B row of that lot fails with LOT_NOT_AVAILABLE and leaves row X alone", async () => {
    await sql.db.exec(`
      INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id)
      VALUES ('MB-000001', 'L1', '2027-01-01', 5, '2026-09-02', ${DEPT_A});
    `);
    const [x] = await rows<{ id: number }>("SELECT id FROM inventory WHERE lot_no = 'L1'");

    const error = await catchError(runDispenseBatch([{ inventoryId: x.id, itemId: "MB-000001", lotNo: "L1", qty: 2 }], userB, audit, ONE_B));

    expect(error).toMatchObject({ code: "LOT_NOT_AVAILABLE" });
    expect(Number((await rows<{ quantity: string }>(`SELECT quantity FROM inventory WHERE id = ${x.id}`))[0].quantity)).toBe(5);
    expect(await dispenseLogs()).toHaveLength(0);
  });

  it("e) inventory whose department differs from its master item is not dispensable (LOT_NOT_AVAILABLE) and not touched", async () => {
    await sql.db.exec(`UPDATE inventory SET department_id = ${DEPT_A} WHERE item_id = 'MB-000002'`);
    const before = await stock();

    const error = await catchError(runDispenseBatch([{ itemId: "MB-000002", lotNo: "LB2", qty: 1 }], userB, audit, ONE_B));

    expect(error).toMatchObject({ code: "LOT_NOT_AVAILABLE" });
    expect(await stock()).toEqual(before);
    expect(await dispenseLogs()).toHaveLength(0);
  });

  it("f) an inactive item of the user's department is REAGENT_INACTIVE and nothing is written", async () => {
    await sql.db.exec("UPDATE master_data SET is_active = FALSE WHERE item_id = 'MB-000002'");
    const before = await stock();

    const error = await catchError(runDispenseBatch([{ itemId: "MB-000002", lotNo: "LB2", qty: 1 }], userB, audit, ONE_B));

    expect(error).toMatchObject({ code: "REAGENT_INACTIVE" });
    expect(await stock()).toEqual(before);
    expect(await dispenseLogs()).toHaveLength(0);
  });

  it("g) mode all is read-only: DEPARTMENT_READ_ONLY before any SQL runs", async () => {
    const before = await stock();
    const query = vi.spyOn(sql.db, "query");
    const exec = vi.spyOn(sql.db, "exec");
    const transaction = vi.spyOn(sql.db, "transaction");

    const error = await catchError(runDispenseBatch([{ itemId: "MB-000001", lotNo: "LB1", qty: 1 }], userB, audit, { mode: "all" }));

    expect(error).toBeInstanceOf(DepartmentScopeError);
    expect(error).toMatchObject({ code: "DEPARTMENT_READ_ONLY" });
    expect(query).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    query.mockRestore();
    expect(await stock()).toEqual(before);
    expect(await dispenseLogs()).toHaveLength(0);
  });

  it("h) legacy mode on a migrated schema dispenses as before; the new log row gets the column default (department CC)", async () => {
    await runDispenseBatch([
      { itemId: "A-000002", lotNo: "LA1", qty: 2 },
      { itemId: "MB-000001", lotNo: "LB1", qty: 1 },
    ], userB, audit, { mode: "legacy" });

    expect(await stock()).toEqual([`A-000002/LA1/d${DEPT_A}=8`, `MB-000001/LB1/d${DEPT_B}=9`, `MB-000002/LB2/d${DEPT_B}=4`]);
    const logs = await dispenseLogs();
    // legacy writes no department_id, so even the department B item is logged under the default department (known legacy behaviour).
    expect(logs.map((row) => [row.item_id, row.department_id])).toEqual([["A-000002", DEPT_A], ["MB-000001", DEPT_A]]);
  });

  it("i) a cart with an item of each department fails as a whole and writes nothing", async () => {
    const before = await stock();

    const error = await catchError(runDispenseBatch([
      { itemId: "MB-000001", lotNo: "LB1", qty: 1 },
      { itemId: "A-000002", lotNo: "LA1", qty: 1 },
    ], userB, audit, ONE_B));

    expect(error).toMatchObject({ code: "ITEM_NOT_IN_DEPARTMENT" });
    expect(await stock()).toEqual(before);
    expect(await dispenseLogs()).toHaveLength(0);
  });

  it("j) lines with qty <= 0 or NaN are dropped before the department check, even for another department's item", async () => {
    const result = await runDispenseBatch([
      { itemId: "A-000002", lotNo: "LA1", qty: 0 },
      { itemId: "NOPE-1", lotNo: "L1", qty: Number.NaN },
      { itemId: "MB-000001", lotNo: "LB1", qty: 2 },
    ], userB, audit, ONE_B);

    expect(result.success).toBe(true);
    expect(await stock()).toEqual([`A-000002/LA1/d${DEPT_A}=10`, `MB-000001/LB1/d${DEPT_B}=8`, `MB-000002/LB2/d${DEPT_B}=4`]);
    expect(await dispenseLogs()).toHaveLength(1);
  });

  it("j2) a cart with only qty <= 0 lines does nothing", async () => {
    const result = await runDispenseBatch([{ itemId: "A-000002", lotNo: "LA1", qty: 0 }], userB, audit, ONE_B);
    expect(result).toEqual({ success: true, message: "ไม่มีรายการที่ต้องเบิกจ่าย" });
  });

  it("k) a row moved to another department between the check and the write is caught by the transaction asserts", async () => {
    const original = sql.transaction.bind(sql);
    vi.spyOn(sql, "transaction").mockImplementationOnce(async (queries) => {
      // Simulates another request re-assigning the row after runDispenseBatch chose it.
      await sql.db.exec(`UPDATE inventory SET department_id = ${DEPT_A} WHERE item_id = 'MB-000001'`);
      return original(queries);
    });

    const error = await catchError(runDispenseBatch([{ itemId: "MB-000001", lotNo: "LB1", qty: 2 }], userB, audit, ONE_B));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/REAGENT_STOCK_INSUFFICIENT: MB-000001/);
    expect(Number((await rows<{ quantity: string }>("SELECT quantity FROM inventory WHERE item_id = 'MB-000001'"))[0].quantity)).toBe(10);
    expect(await dispenseLogs()).toHaveLength(0);
  });

  it("l) department A users dispense A items and cannot dispense B items (symmetry)", async () => {
    const userA = { username: "solo1", name: "Solo One", role: "User" };
    await runDispenseBatch([{ itemId: "A-000002", lotNo: "LA1", qty: 1 }], userA, audit, ONE_A);
    const error = await catchError(runDispenseBatch([{ itemId: "MB-000001", lotNo: "LB1", qty: 1 }], userA, audit, ONE_A));

    expect(error).toMatchObject({ code: "ITEM_NOT_IN_DEPARTMENT" });
    expect(await stock()).toEqual([`A-000002/LA1/d${DEPT_A}=9`, `MB-000001/LB1/d${DEPT_B}=10`, `MB-000002/LB2/d${DEPT_B}=4`]);
    expect((await dispenseLogs()).map((row) => row.department_id)).toEqual([DEPT_A]);
  });
});

// PGlite has no trg_inventory_require_active_master_data (upgrade_v24 trigger), so the inactive-item case below is
// covered by the JS check and labstock_assert only; the trigger itself is verified in the Neon rehearsal.
const RECEIVE_ACTION = "รับเข้าสต๊อกหลัก";
const receiveLogs = () => rows<{ item_id: string; lot_no: string; quantity: string; department_id: number }>(
  `SELECT item_id, lot_no, quantity, department_id FROM logs WHERE action = '${RECEIVE_ACTION}' ORDER BY id`,
);
const lotRows = (lot: string) => rows<{ item_id: string; quantity: string; department_id: number; exp_date: string | null; today: boolean }>(
  `SELECT item_id, quantity, department_id, to_char(exp_date, 'YYYY-MM-DD') AS exp_date, received_on = CURRENT_DATE AS today
   FROM inventory WHERE lot_no = '${lot}' ORDER BY id`,
);

describe("runReceiveBatch with a department scope", () => {
  it("r1) receiving the same lot twice on one day in department B keeps one row with the summed quantity", async () => {
    await runReceiveBatch([{ itemId: "MB-000001", lotNo: "LN1", qty: 2 }], userB, audit, ONE_B);
    await runReceiveBatch([{ itemId: "MB-000001", lotNo: "LN1", qty: 3 }], userB, audit, ONE_B);

    const lot = await lotRows("LN1");
    expect(lot).toHaveLength(1);
    expect(lot[0]).toMatchObject({ item_id: "MB-000001", department_id: DEPT_B, today: true });
    expect(Number(lot[0].quantity)).toBe(5);
    const logs = await receiveLogs();
    expect(logs.map((row) => [row.lot_no, Number(row.quantity), row.department_id])).toEqual([["LN1", 2, DEPT_B], ["LN1", 3, DEPT_B]]);
  });

  it("r2) an item of another department is refused with ITEM_NOT_IN_DEPARTMENT and nothing changes", async () => {
    const before = await stock();
    const error = await catchError(runReceiveBatch([{ itemId: "A-000002", lotNo: "LA1", qty: 2 }], userB, audit, ONE_B));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "ITEM_NOT_IN_DEPARTMENT", userMessage: "รายการนี้ไม่อยู่ในงานของคุณ (A-000002)" });
    expect(await stock()).toEqual(before);
    expect(await receiveLogs()).toHaveLength(0);
  });

  it("r3) a same-day row of the same item/lot owned by another department is not added to or relabelled", async () => {
    // Inconsistent data: a department B item whose row for today sits in department A.
    await sql.db.exec(`
      INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id)
      VALUES ('MB-000001', 'LX', NULL, 5, CURRENT_DATE, ${DEPT_A});
    `);
    const before = await stock();

    const error = await catchError(runReceiveBatch([{ itemId: "MB-000001", lotNo: "LX", qty: 2 }], userB, audit, ONE_B));

    expect((error as Error).message).toMatch(/^ITEM_NOT_IN_DEPARTMENT: MB-000001/);
    expect(await stock()).toEqual(before);
    expect(await receiveLogs()).toHaveLength(0);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { response } = toApiError(error, "req-r3");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("รายการนี้ไม่อยู่ในงานของคุณ (MB-000001)");
  });

  it("r4) an item id that does not exist gets ITEM_NOT_IN_DEPARTMENT", async () => {
    const before = await stock();
    const error = await catchError(runReceiveBatch([{ itemId: "NOPE-1", lotNo: "L1", qty: 1 }], userB, audit, ONE_B));

    expect(error).toMatchObject({ code: "ITEM_NOT_IN_DEPARTMENT", userMessage: "รายการนี้ไม่อยู่ในงานของคุณ (NOPE-1)" });
    expect(await stock()).toEqual(before);
    expect(await receiveLogs()).toHaveLength(0);
  });

  it("r5) an inactive item of the user's department is REAGENT_INACTIVE and nothing is written", async () => {
    await sql.db.exec("UPDATE master_data SET is_active = FALSE WHERE item_id = 'MB-000002'");
    const before = await stock();

    const error = await catchError(runReceiveBatch([{ itemId: "MB-000002", lotNo: "LN5", qty: 1 }], userB, audit, ONE_B));

    expect(error).toMatchObject({ code: "REAGENT_INACTIVE" });
    expect(await stock()).toEqual(before);
    expect(await receiveLogs()).toHaveLength(0);
  });

  it("r6) mode all is read-only: DEPARTMENT_READ_ONLY before any SQL runs", async () => {
    const before = await stock();
    const query = vi.spyOn(sql.db, "query");
    const exec = vi.spyOn(sql.db, "exec");
    const transaction = vi.spyOn(sql.db, "transaction");

    const error = await catchError(runReceiveBatch([{ itemId: "MB-000001", lotNo: "LN6", qty: 1 }], userB, audit, { mode: "all" }));

    expect(error).toBeInstanceOf(DepartmentScopeError);
    expect(error).toMatchObject({ code: "DEPARTMENT_READ_ONLY" });
    expect(query).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    query.mockRestore();
    expect(await stock()).toEqual(before);
    expect(await receiveLogs()).toHaveLength(0);
  });

  it("r7) legacy mode on a migrated schema receives as before; new rows get the column default (department CC)", async () => {
    await runReceiveBatch([
      { itemId: "A-000002", lotNo: "LN7", qty: 2 },
      { itemId: "MB-000001", lotNo: "LN7", qty: 1 },
    ], userB, audit, { mode: "legacy" });

    // legacy writes no department_id, so even the department B item lands in the default department (known legacy behaviour).
    const lot = await lotRows("LN7");
    expect(lot.map((row) => [row.item_id, Number(row.quantity), row.department_id])).toEqual([["A-000002", 2, DEPT_A], ["MB-000001", 1, DEPT_A]]);
    expect((await receiveLogs()).map((row) => row.department_id)).toEqual([DEPT_A, DEPT_A]);
  });

  it("r8) a cart with an item of each department fails as a whole and writes nothing", async () => {
    const before = await stock();

    const error = await catchError(runReceiveBatch([
      { itemId: "MB-000001", lotNo: "LN8", qty: 1 },
      { itemId: "A-000002", lotNo: "LN8", qty: 1 },
    ], userB, audit, ONE_B));

    expect(error).toMatchObject({ code: "ITEM_NOT_IN_DEPARTMENT" });
    expect(await stock()).toEqual(before);
    expect(await receiveLogs()).toHaveLength(0);
  });

  it("r8b) a failure inside the transaction rolls back the lines before it", async () => {
    await sql.db.exec(`
      INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id)
      VALUES ('MB-000002', 'LX', NULL, 5, CURRENT_DATE, ${DEPT_A});
    `);
    const before = await stock();

    const error = await catchError(runReceiveBatch([
      { itemId: "MB-000001", lotNo: "LN8B", qty: 1 },
      { itemId: "MB-000002", lotNo: "LX", qty: 1 },
    ], userB, audit, ONE_B));

    expect((error as Error).message).toMatch(/^ITEM_NOT_IN_DEPARTMENT: MB-000002/);
    expect(await stock()).toEqual(before);
    expect(await receiveLogs()).toHaveLength(0);
  });

  it("r9) a receive without an expiry date does not overwrite the existing one", async () => {
    await runReceiveBatch([{ itemId: "MB-000001", lotNo: "LN9", qty: 1, expDate: "2027-05-05" }], userB, audit, ONE_B);
    await runReceiveBatch([{ itemId: "MB-000001", lotNo: "LN9", qty: 1 }], userB, audit, ONE_B);

    const lot = await lotRows("LN9");
    expect(lot).toHaveLength(1);
    expect(lot[0].exp_date).toBe("2027-05-05");
    expect(Number(lot[0].quantity)).toBe(2);
  });

  it("r10) lines with qty <= 0 are dropped before the department check, even for another department's item", async () => {
    const result = await runReceiveBatch([
      { itemId: "A-000002", lotNo: "LN10", qty: 0 },
      { itemId: "NOPE-1", lotNo: "LN10", qty: Number.NaN },
      { itemId: "MB-000001", lotNo: "LN10", qty: 2 },
    ], userB, audit, ONE_B);

    expect(result).toEqual({ success: true, message: "รับเข้าสำเร็จ 1 รายการ" });
    expect((await lotRows("LN10")).map((row) => [row.item_id, row.department_id])).toEqual([["MB-000001", DEPT_B]]);
    expect(await receiveLogs()).toHaveLength(1);
  });
});
