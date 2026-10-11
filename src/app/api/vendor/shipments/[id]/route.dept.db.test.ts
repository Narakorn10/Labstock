import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of the lab-side shipment receipt / cancel route on the production schema + v30-v34 (PGlite).

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  recordPurchaseOrderCommunication: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/po-communication", () => ({ recordPurchaseOrderCommunication: mocks.recordPurchaseOrderCommunication }));
vi.mock("@/lib/feature-flags", () => ({ SHIPMENTS_ENABLED: true, SHIPMENTS_DISABLED_MESSAGE: "disabled" }));

import dbSql from "@/lib/db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { PATCH } from "./route";

const sql = dbSql as unknown as PgliteSql;
const managerB = { username: "managerb", name: "Manager B", role: "Manager", scope: DEPT_B };

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
    -- Not part of the prod DDL used by the fixtures.
    CREATE TABLE purchase_order_items (
      id SERIAL PRIMARY KEY, po_id INT REFERENCES purchase_orders(id), item_id TEXT, item_name TEXT, quantity NUMERIC,
      unit TEXT, received_qty NUMERIC, accepted_qty NUMERIC, rejected_qty NUMERIC
    );
  `);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

// Shipment 1 belongs to department B (item MB-000001, PO-B1), shipment 2 to department A (item A-000002, PO-A1). Both In Transit, qty 10.
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(managerB);
  await sql.db.exec(`
    TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders, inventory, logs RESTART IDENTITY CASCADE;
    INSERT INTO purchase_orders (po_number, vendor, created_by, status, department_id) VALUES
      ('PO-B1', 'MB Vendor', 'managerb', 'CONFIRMED', ${DEPT_B}),
      ('PO-A1', 'Vendor A', 'manager1', 'CONFIRMED', ${DEPT_A});
    INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit) VALUES
      (1, 'MB-000001', 'Dept B item 1', 10, 'box'),
      (2, 'A-000002', 'Dept A extra item', 10, 'box');
    INSERT INTO shipments (vendor, item_id, lot_no, exp_date, quantity, status, po_number, department_id) VALUES
      ('MB Vendor', 'MB-000001', 'LS1', '2099-01-01', 10, 'In Transit', 'PO-B1', ${DEPT_B}),
      ('Vendor A', 'A-000002', 'LS2', '2099-01-01', 10, 'In Transit', 'PO-A1', ${DEPT_A});
  `);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

function patch(id: number, body: Record<string, unknown> = {}) {
  return PATCH(
    new Request(`http://localhost/api/vendor/shipments/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}
const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;
const shipmentStatuses = async () => (await rows<{ status: string }>("SELECT status FROM shipments ORDER BY id")).map((row) => row.status);

describe("shipment receipt with a department scope", () => {
  it("receives an own shipment and writes the department on inventory and logs", async () => {
    const response = await patch(1);

    expect(response.status).toBe(200);
    expect(await shipmentStatuses()).toEqual(["Received", "In Transit"]);
    expect(await rows("SELECT item_id, lot_no, quantity, department_id FROM inventory")).toEqual([
      { item_id: "MB-000001", lot_no: "LS1", quantity: "10", department_id: DEPT_B },
    ]);
    expect(await rows("SELECT department_id FROM logs")).toEqual([{ department_id: DEPT_B }]);
    expect(await rows("SELECT status FROM purchase_orders WHERE po_number = 'PO-B1'")).toEqual([{ status: "RECEIVED" }]);
  });

  it("does not find a shipment of another department (receive and cancel) and changes nothing", async () => {
    const receive = await patch(2);
    const cancel = await patch(2, { action: "cancel" });

    expect(receive.status).toBe(404);
    expect(cancel.status).toBe(404);
    expect(await shipmentStatuses()).toEqual(["In Transit", "In Transit"]);
    expect(await rows("SELECT 1 FROM inventory")).toHaveLength(0);
  });

  it("cancels an own shipment", async () => {
    const response = await patch(1, { action: "cancel" });

    expect(response.status).toBe(200);
    expect(await shipmentStatuses()).toEqual(["Cancelled", "In Transit"]);
  });

  it("refuses to merge into an inventory row of another department (409, shipment stays In Transit)", async () => {
    // Inconsistent data on purpose: a department A row for B's item with today's received_on and the same lot.
    await sql.db.exec(`INSERT INTO inventory (item_id, lot_no, quantity, received_on, department_id) VALUES ('MB-000001', 'LS1', 3, CURRENT_DATE, ${DEPT_A})`);

    const response = await patch(1);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ITEM_NOT_IN_DEPARTMENT");
    expect(await shipmentStatuses()).toEqual(["In Transit", "In Transit"]);
    expect(await rows("SELECT quantity, department_id FROM inventory")).toEqual([{ quantity: "3", department_id: DEPT_A }]);
    expect(await rows("SELECT 1 FROM logs")).toHaveLength(0);
  });

  it("a fully rejected delivery never touches inventory, so the cross-department check does not apply", async () => {
    await sql.db.exec(`INSERT INTO inventory (item_id, lot_no, quantity, received_on, department_id) VALUES ('MB-000001', 'LS1', 3, CURRENT_DATE, ${DEPT_A})`);

    const response = await patch(1, { accepted_qty: 0, rejected_qty: 10, rejection_reason: "broken" });

    expect(response.status).toBe(200);
    expect(await shipmentStatuses()).toEqual(["Received", "In Transit"]);
    expect(await rows("SELECT quantity, department_id FROM inventory")).toEqual([{ quantity: "3", department_id: DEPT_A }]);
  });

  it("answers the same 400 as legacy when the shipment is received by someone else between the read and the write", async () => {
    const answers: Array<{ status: number; error: string }> = [];
    for (const user of [managerB, { username: "legacy", name: "Legacy", role: "Manager" }]) {
      await sql.db.exec("UPDATE shipments SET status = 'In Transit' WHERE id = 1");
      mocks.getAuthenticatedUser.mockResolvedValue(user);
      const realTransaction = sql.transaction.bind(sql);
      vi.spyOn(sql, "transaction").mockImplementationOnce(async (queries) => {
        await sql.db.exec("UPDATE shipments SET status = 'Received' WHERE id = 1");
        return realTransaction(queries);
      });

      const response = await patch(1);
      answers.push({ status: response.status, error: (await response.json()).error });
      vi.restoreAllMocks();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    }

    expect(answers[0].status).toBe(400);
    expect(answers[0].error).toContain("ถูกรับเข้าหรือยกเลิกไปก่อนหน้าแล้ว");
    expect(answers[1]).toEqual(answers[0]);
    expect(await rows("SELECT 1 FROM inventory")).toHaveLength(0);
  });

  it("answers 409 DEPARTMENT_READ_ONLY in mode all before any write", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...managerB, scope: "ALL" });

    const response = await patch(1);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await shipmentStatuses()).toEqual(["In Transit", "In Transit"]);
  });

  it("answers 500 without the username when the user has no scope while departments are ready", async () => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    resetDepartmentsFlagForTests();
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "secret.person", name: "Secret", role: "Manager" });

    const response = await patch(1);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret.person");
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
    expect(await shipmentStatuses()).toEqual(["In Transit", "In Transit"]);
  });
});
