import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of the count work-order flow on the production schema + v30-v34 (PGlite).
// The prod DDL used by the fixtures has no count_work_order_items / _allocations / _audit tables, so they are created here.

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import { AppError } from "./errors";
import { DepartmentScopeError, type DepartmentScope } from "./scoped-db";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import {
  cancelCountWorkOrder,
  confirmCountWorkOrder,
  CountConfirmError,
  getCountWorkOrder,
  getFreshLots,
  listCountWorkOrders,
  saveCountWorkOrder,
} from "./count-work-orders";

const sql = dbSql as unknown as PgliteSql;
const ONE_A: DepartmentScope = { mode: "one", departmentId: DEPT_A };
const ONE_B: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const ALL: DepartmentScope = { mode: "all" };
const audit = { userAgent: "test", ipAddress: "127.0.0.1" };
const ownerX = { username: "ownerx", name: "Owner X", role: "User" };
const ownerY = { username: "ownery", name: "Owner Y", role: "User" };
const manager = { username: "mgr", name: "Manager", role: "Manager" };

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
  `);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

// Department A owns A-000002; department B owns MB-000001 and MB-000002. All three have weekly target 10 and job type Routine.
// Lots: A-000002 -> id 1 (dept A), MB-000001 -> id 2 (dept B), MB-000002 -> id 3 (dept B).
beforeEach(async () => {
  await sql.db.exec(`
    TRUNCATE count_work_order_audit, count_work_order_allocations, count_work_order_items, count_work_orders, logs, inventory RESTART IDENTITY CASCADE;
    UPDATE master_data SET is_active = TRUE;
    UPDATE master_data SET weekly_target = 10, job_type = 'Routine' WHERE item_id IN ('A-000002', 'MB-000001', 'MB-000002');
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on, department_id) VALUES
      ('A-000002', 'LA1', '2027-01-01', 100, '2026-09-01', ${DEPT_A}),
      ('MB-000001', 'LB1', '2027-01-01', 100, '2026-09-01', ${DEPT_B}),
      ('MB-000002', 'LB2', '2027-01-01', 100, '2026-09-01', ${DEPT_B});
  `);
});

const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;
const stock = async () => (await rows<{ item_id: string; quantity: string }>("SELECT item_id, quantity FROM inventory ORDER BY id"))
  .map((row) => `${row.item_id}=${Number(row.quantity)}`).join(",");
const alloc = (itemId: string, inventoryId: number, qty: number) => ({ itemId, inventoryId, qty });
const catchError = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

describe("saveCountWorkOrder with a department scope", () => {
  it("creates the order in the user's department", async () => {
    const result = await saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 4 }], ONE_B);

    expect(result.savedCount).toBe(1);
    expect(await rows("SELECT department_id, owner_username FROM count_work_orders")).toEqual([{ department_id: DEPT_B, owner_username: "ownery" }]);
    expect(await rows("SELECT item_id, required_qty FROM count_work_order_items")).toEqual([{ item_id: "MB-000001", required_qty: "6" }]);
  });

  it("answers ITEM_NOT_IN_DEPARTMENT (not a count mismatch) for an item of another department and writes nothing", async () => {
    const error = await catchError(saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 4 }, { itemId: "A-000002", countedQty: 1 }], ONE_B));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("ITEM_NOT_IN_DEPARTMENT");
    expect((error as AppError).userMessage).toContain("A-000002");
    expect(await rows("SELECT 1 FROM count_work_orders")).toHaveLength(0);
  });

  it("does not take over an OPEN order of another department (same owner and job type)", async () => {
    // The old system-wide unique index lets only one OPEN order exist per owner + job type, so saving in B finds A's order.
    await saveCountWorkOrder(ownerX, "Routine", [{ itemId: "A-000002", countedQty: 4 }], ONE_A);
    const before = await rows<{ id: string; updated_at: string }>("SELECT id, updated_at::text AS updated_at FROM count_work_orders");

    const error = await catchError(saveCountWorkOrder(ownerX, "Routine", [{ itemId: "MB-000001", countedQty: 4 }], ONE_B));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_FAILED");
    expect(await rows<{ id: string; updated_at: string }>("SELECT id, updated_at::text AS updated_at FROM count_work_orders")).toEqual(before);
    expect(await rows("SELECT item_id FROM count_work_order_items")).toEqual([{ item_id: "A-000002" }]);
  });

  it("re-saving an own OPEN order updates it in place", async () => {
    const first = await saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 4 }], ONE_B);
    const second = await saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 8 }], ONE_B);

    expect(second.id).toBe(first.id);
    expect(await rows("SELECT required_qty FROM count_work_order_items")).toEqual([{ required_qty: "2" }]);
  });

  it("rejects writes in mode all before any SQL", async () => {
    const error = await catchError(saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 4 }], ALL));

    expect(error).toBeInstanceOf(DepartmentScopeError);
    expect((error as DepartmentScopeError).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await rows("SELECT 1 FROM count_work_orders")).toHaveLength(0);
  });
});

describe("reading count work orders with a department scope", () => {
  // A1 (ownerx, Routine, dept A), B1 (ownery, Routine, dept B), B2 (ownerx, '', dept B).
  async function seedOrders() {
    await saveCountWorkOrder(ownerX, "Routine", [{ itemId: "A-000002", countedQty: 4 }], ONE_A);
    await saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 4 }], ONE_B);
    await sql.db.exec(`INSERT INTO count_work_orders (owner_username, job_type, department_id) VALUES ('ownerx', '', ${DEPT_B})`);
  }
  const owners = (list: unknown[]) => (list as Array<{ ownerUsername: string; jobType: string }>).map((row) => `${row.ownerUsername}/${row.jobType}`).sort();

  it("a reviewer sees only the orders of the chosen department", async () => {
    await seedOrders();

    expect(owners(await listCountWorkOrders(manager, ONE_B))).toEqual(["ownerx/", "ownery/Routine"]);
    expect(owners(await listCountWorkOrders(manager, ONE_A))).toEqual(["ownerx/Routine"]);
  });

  it("a non-reviewer sees only their own orders of the chosen department", async () => {
    await seedOrders();

    expect(owners(await listCountWorkOrders(ownerX, ONE_B))).toEqual(["ownerx/"]);
    expect(owners(await listCountWorkOrders(ownerX, ONE_A))).toEqual(["ownerx/Routine"]);
  });

  it("mode all lists every department", async () => {
    await seedOrders();

    expect(await listCountWorkOrders(manager, ALL)).toHaveLength(3);
  });

  it("getCountWorkOrder returns null for an order of another department", async () => {
    await seedOrders();
    const aOrder = (await rows<{ id: string }>(`SELECT id FROM count_work_orders WHERE department_id = ${DEPT_A}`))[0];

    expect(await getCountWorkOrder(manager, Number(aOrder.id), ONE_B)).toBeNull();
    expect(await getCountWorkOrder(manager, Number(aOrder.id), ONE_A)).not.toBeNull();
  });

  it("getFreshLots lists only lots of the order's department", async () => {
    const saved = await saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 4 }], ONE_B);
    await sql.db.exec(`INSERT INTO inventory (item_id, lot_no, quantity, received_on, department_id) VALUES ('MB-000001', 'LFOREIGN', 5, '2026-09-02', ${DEPT_A})`);

    const lots = await getFreshLots(ownerY, saved.id, ONE_B) as Array<{ lotNo: string }>;

    expect(lots.map((lot) => lot.lotNo)).toEqual(["LB1"]);
    expect(await getFreshLots(ownerY, saved.id, ONE_A)).toBeNull();
  });
});

describe("cancelCountWorkOrder with a department scope", () => {
  it("cancels an own order, but not one of another department", async () => {
    const saved = await saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 4 }], ONE_B);

    const error = await catchError(cancelCountWorkOrder(ownerY, saved.id, ONE_A));
    expect((error as AppError).code).toBe("COUNT_ORDER_NOT_FOUND");
    expect(await rows("SELECT status FROM count_work_orders")).toEqual([{ status: "OPEN" }]);

    await cancelCountWorkOrder(ownerY, saved.id, ONE_B);
    expect(await rows("SELECT status FROM count_work_orders")).toEqual([{ status: "CANCELLED" }]);
  });

  it("rejects mode all before any SQL", async () => {
    const saved = await saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 4 }], ONE_B);

    const error = await catchError(cancelCountWorkOrder(ownerY, saved.id, ALL));

    expect((error as DepartmentScopeError).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await rows("SELECT status FROM count_work_orders")).toEqual([{ status: "OPEN" }]);
  });
});

describe("confirmCountWorkOrder with a department scope", () => {
  async function openOrder() {
    return saveCountWorkOrder(ownerY, "Routine", [{ itemId: "MB-000001", countedQty: 4 }], ONE_B);
  }

  it("dispenses from the department's lot and writes the department on the log", async () => {
    const { id } = await openOrder();

    const result = await confirmCountWorkOrder(ownerY, id, [alloc("MB-000001", 2, 6)], audit, ONE_B);

    expect(result.status).toBe("CONFIRMED");
    expect(await stock()).toBe("A-000002=100,MB-000001=94,MB-000002=100");
    expect(await rows("SELECT department_id, item_id FROM logs")).toEqual([{ department_id: DEPT_B, item_id: "MB-000001" }]);
  });

  it("does not find an order of another department", async () => {
    const { id } = await openOrder();

    const error = await catchError(confirmCountWorkOrder(ownerY, id, [alloc("MB-000001", 2, 6)], audit, ONE_A));

    expect((error as AppError).code).toBe("COUNT_ORDER_NOT_FOUND");
    expect(await stock()).toBe("A-000002=100,MB-000001=100,MB-000002=100");
    expect(await rows("SELECT 1 FROM logs")).toHaveLength(0);
  });

  it("treats a lot of another department as LOT_INVALID and leaves its stock alone", async () => {
    const { id } = await openOrder();
    await sql.db.exec(`INSERT INTO inventory (item_id, lot_no, quantity, received_on, department_id) VALUES ('MB-000001', 'LFOREIGN', 50, '2026-09-02', ${DEPT_A})`);

    const error = await catchError(confirmCountWorkOrder(ownerY, id, [alloc("MB-000001", 4, 6)], audit, ONE_B));

    expect(error).toBeInstanceOf(CountConfirmError);
    expect((error as CountConfirmError).failed.map((item) => `${item.itemId}:${item.reason}`)).toEqual(["MB-000001:LOT_INVALID"]);
    expect(await stock()).toBe("A-000002=100,MB-000001=100,MB-000002=100,MB-000001=50");
    expect(await rows("SELECT status FROM count_work_orders")).toEqual([{ status: "OPEN" }]);
  });

  it("does not reveal the name of an item of another department in the failure list", async () => {
    const { id } = await openOrder();

    const error = await catchError(confirmCountWorkOrder(ownerY, id, [alloc("A-000002", 1, 6)], audit, ONE_B));

    expect(error).toBeInstanceOf(CountConfirmError);
    expect((error as CountConfirmError).failed).toEqual([expect.objectContaining({ itemId: "A-000002", name: null, reason: "NOT_PENDING" })]);
    expect(await stock()).toBe("A-000002=100,MB-000001=100,MB-000002=100");
  });

  it("rejects mode all before any SQL", async () => {
    const { id } = await openOrder();

    const error = await catchError(confirmCountWorkOrder(ownerY, id, [alloc("MB-000001", 2, 6)], audit, ALL));

    expect((error as DepartmentScopeError).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await stock()).toBe("A-000002=100,MB-000001=100,MB-000002=100");
  });
});
