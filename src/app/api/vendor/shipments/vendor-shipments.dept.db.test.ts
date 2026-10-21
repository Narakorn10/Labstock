import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department (multi-lab) behaviour of the Vendor shipment routes (GET/POST shipments, OCR, GET orders) on the production
// schema + v30-v34 (PGlite). Policy A (owner question #3 still OPEN): a Vendor is filtered by company name only, may ship
// POs of any department, and the shipment is stamped with the PO's department, never with the Vendor account's own one.

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
import { GET as shipmentsGET, POST as shipmentsPOST } from "./route";
import { POST as ocrPOST } from "./ocr/route";
import { GET as ordersGET } from "./orders/route";
import { PATCH as receivePATCH } from "./[id]/route";

const sql = dbSql as unknown as PgliteSql;
// The Vendor ACCOUNT belongs to department A, but the company "MB Vendor" also supplies department B (policy A).
const vendorInA = { username: "vendor1", name: "Vendor One", role: "Vendor", vendor: "MB Vendor", scope: DEPT_A };
const otherVendor = { username: "vendor2", name: "Vendor Two", role: "Vendor", vendor: "Other Co", scope: DEPT_A };
const managerA = { username: "manager1", name: "Manager A", role: "Manager", scope: DEPT_A };
const managerB = { username: "managerb", name: "Manager B", role: "Manager", scope: DEPT_B };
const adminAll = { username: "admin1", name: "Admin", role: "Admin", scope: "ALL" };
const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  await seedTwoDepartments(sql);
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

// PO-B1: department B, company MB Vendor, items MB-000001 (rule: 90 days) + MB-000002, qty 10 each.
// PO-A1: department A, company MB Vendor (the same company), item A-000002.
// PO-O:  department B, company Other Co.
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(vendorInA);
  await sql.db.exec(`
    TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders, inventory, logs RESTART IDENTITY CASCADE;
    UPDATE master_data SET min_shelf_life_days = NULL;
    UPDATE master_data SET min_shelf_life_days = 90 WHERE item_id = 'MB-000001';
    INSERT INTO purchase_orders (po_number, vendor, created_by, status, department_id) VALUES
      ('PO-B1', 'MB Vendor', 'managerb', 'CONFIRMED', ${DEPT_B}),
      ('PO-A1', 'MB Vendor', 'manager1', 'CONFIRMED', ${DEPT_A}),
      ('PO-O', 'Other Co', 'managerb', 'CONFIRMED', ${DEPT_B});
    INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit) VALUES
      (1, 'MB-000001', 'Dept B item 1', 10, 'box'),
      (1, 'MB-000002', 'Dept B item 2', 10, 'kit'),
      (2, 'A-000002', 'Dept A extra item', 10, 'box'),
      (3, 'MB-000001', 'Dept B item 1', 10, 'box');
  `);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDepartmentsFlagForTests();
});

type Line = { itemId: string; qty: number; expDate?: string; lotNo?: string };
function ship(lines: Line[], extra: Record<string, unknown> = {}, poNumber = "PO-B1") {
  return shipmentsPOST(new Request("http://localhost/api/vendor/shipments", {
    method: "POST",
    body: JSON.stringify({
      poNumber, referenceNo: "DN-1",
      items: lines.map((line, index) => ({ itemId: line.itemId, lotNo: line.lotNo ?? `L${index}`, expDate: line.expDate ?? "2099-01-01", qty: line.qty })),
      ...extra,
    }),
  }));
}
const list = () => shipmentsGET(new Request("http://localhost/api/vendor/shipments"));
const orders = () => ordersGET(new Request("http://localhost/api/vendor/shipments/orders"));
const ocr = (poNumber: string) => ocrPOST(new Request("http://localhost/api/vendor/shipments/ocr", { method: "POST", body: JSON.stringify({ poNumber, text: "MB-000001 lot L1 qty 4" }) }));
const receive = (id: number) => receivePATCH(
  new Request(`http://localhost/api/vendor/shipments/${id}`, { method: "PATCH", body: JSON.stringify({}) }),
  { params: Promise.resolve({ id: String(id) }) },
);
const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;
const noRowsWritten = async () => {
  expect(await rows("SELECT 1 FROM shipments")).toHaveLength(0);
  expect(await rows("SELECT 1 FROM shipment_batches")).toHaveLength(0);
};

describe("Vendor POST /shipments stamps the PO's department", () => {
  it("a Vendor whose account is dept A shipping a PO of dept B stamps the batch and the shipments with B", async () => {
    const response = await ship([{ itemId: "MB-000001", qty: 4 }, { itemId: "MB-000002", qty: 3 }]);

    expect(response.status).toBe(201);
    expect(await rows("SELECT department_id FROM shipment_batches")).toEqual([{ department_id: DEPT_B }]);
    expect(await rows("SELECT item_id, department_id FROM shipments ORDER BY id")).toEqual([
      { item_id: "MB-000001", department_id: DEPT_B },
      { item_id: "MB-000002", department_id: DEPT_B }, // multi-item: the same department on every row
    ]);
  });

  it("enforces the shelf-life rule of the PO's department (the Vendor's own department has no such rule)", async () => {
    const response = await ship([{ itemId: "MB-000001", qty: 4, expDate: inDays(10) }]);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("SHELF_LIFE_BELOW_MINIMUM");
    await noRowsWritten();
  });

  it("recomputes the PO status after the shipment (partial, then full)", async () => {
    await ship([{ itemId: "MB-000001", qty: 4 }]);
    expect(await rows("SELECT status FROM purchase_orders WHERE po_number = 'PO-B1'")).toEqual([{ status: "PARTIALLY_SHIPPED" }]);

    await ship([{ itemId: "MB-000001", qty: 6 }, { itemId: "MB-000002", qty: 10 }], { referenceNo: "DN-2" });
    expect(await rows("SELECT status FROM purchase_orders WHERE po_number = 'PO-B1'")).toEqual([{ status: "SHIPPED" }]);
  });

  it("answers duplicate:true (not 500) when the same clientRequestId repeats after a PARTIAL first batch", async () => {
    const first = await ship([{ itemId: "MB-000001", qty: 4 }], { clientRequestId: "req-1" });
    const second = await ship([{ itemId: "MB-000001", qty: 4 }], { clientRequestId: "req-1" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);
    expect(await rows("SELECT 1 FROM shipment_batches")).toHaveLength(1);
    expect(await rows("SELECT 1 FROM shipments")).toHaveLength(1);
  });

  it("answers 409 not eligible for a PO of another company (and for a missing PO) and writes nothing", async () => {
    for (const poNumber of ["PO-O", "PO-NOPE"]) {
      const response = await ship([{ itemId: "MB-000001", qty: 4 }], {}, poNumber);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("This order is not eligible for shipment");
    }
    await noRowsWritten();
  });

  it("a Vendor can also ship a PO of its own account's department (stamped with A)", async () => {
    const response = await ship([{ itemId: "A-000002", qty: 2 }], {}, "PO-A1");

    expect(response.status).toBe(201);
    expect(await rows("SELECT department_id FROM shipments")).toEqual([{ department_id: DEPT_A }]);
  });

  it("fails closed with 500 (no message, no transaction, nothing written) when the PO has no valid department_id", async () => {
    const realQuery = sql.db.query.bind(sql.db);
    const transaction = vi.spyOn(sql, "transaction");
    for (const bad of [null, 0, -1, 1.5, "abc"]) {
      const spy = vi.spyOn(sql.db, "query").mockImplementation(((text: string, params?: unknown[]) =>
        /SELECT department_id FROM purchase_orders/.test(text) ? Promise.resolve({ rows: [{ department_id: bad }] }) : realQuery(text, params)) as never);

      const response = await ship([{ itemId: "MB-000001", qty: 4 }]);
      const text = await response.text();

      expect(response.status, String(bad)).toBe(500);
      expect(text, String(bad)).not.toMatch(/department/i);
      spy.mockRestore();
    }
    expect(transaction).not.toHaveBeenCalled();
    await noRowsWritten();
  });

  it("answers 409 not eligible (nothing written) when the PO changes department between the lookup and the write", async () => {
    const realTransaction = sql.transaction.bind(sql);
    vi.spyOn(sql, "transaction").mockImplementationOnce(async (queries) => {
      await sql.db.exec(`UPDATE purchase_orders SET department_id = ${DEPT_A} WHERE po_number = 'PO-B1'`);
      return realTransaction(queries);
    });

    const response = await ship([{ itemId: "MB-000001", qty: 4 }]);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("This order is not eligible for shipment");
    await noRowsWritten();
  });

  it("answers 409 DEPARTMENT_READ_ONLY for a scope of mode all before any write", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ ...vendorInA, scope: "ALL" });

    const response = await ship([{ itemId: "MB-000001", qty: 4 }]);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEPARTMENT_READ_ONLY");
    await noRowsWritten();
  });

  it("then Manager B can receive the shipment through [id] (inventory in B) and Manager A gets 404", async () => {
    await ship([{ itemId: "MB-000001", qty: 4 }]);

    mocks.getAuthenticatedUser.mockResolvedValue(managerA);
    expect((await receive(1)).status).toBe(404);

    mocks.getAuthenticatedUser.mockResolvedValue(managerB);
    expect((await receive(1)).status).toBe(200);
    expect(await rows("SELECT item_id, quantity, department_id FROM inventory")).toEqual([{ item_id: "MB-000001", quantity: "4", department_id: DEPT_B }]);
  });
});

describe("Vendor shipment reads", () => {
  // S1-S2 belong to B (item of B), S3 to A (item of A), S4 is inconsistent data on purpose (item of B stamped A),
  // S5 is another company's shipment in B, S6 is inconsistent the other way (item of A stamped B).
  beforeEach(async () => {
    await sql.db.exec(`
      INSERT INTO shipments (vendor, item_id, lot_no, exp_date, quantity, status, po_number, department_id) VALUES
        ('MB Vendor', 'MB-000001', 'S1', '2099-01-01', 1, 'In Transit', 'PO-B1', ${DEPT_B}),
        ('MB Vendor', 'MB-000002', 'S2', '2099-01-01', 1, 'In Transit', 'PO-B1', ${DEPT_B}),
        ('MB Vendor', 'A-000002', 'S3', '2099-01-01', 1, 'In Transit', 'PO-A1', ${DEPT_A}),
        ('MB Vendor', 'MB-000001', 'S4', '2099-01-01', 1, 'In Transit', 'PO-B1', ${DEPT_A}),
        ('Other Co', 'MB-000001', 'S5', '2099-01-01', 1, 'In Transit', 'PO-O', ${DEPT_B}),
        ('MB Vendor', 'A-000002', 'S6', '2099-01-01', 1, 'In Transit', 'PO-A1', ${DEPT_B});
    `);
  });

  const lots = async (response: Response) => ((await response.json()) as Array<{ lot_no: string }>).map((row) => row.lot_no).sort();

  it("Manager B sees only the rows whose shipment AND item belong to B", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(managerB);
    expect(await lots(await list())).toEqual(["S1", "S2", "S5"]);
  });

  it("Manager A sees only the rows whose shipment AND item belong to A", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(managerA);
    expect(await lots(await list())).toEqual(["S3"]);
  });

  it("central Admin in mode all sees every department", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(adminAll);
    expect(await lots(await list())).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
  });

  it("locks policy A: a Vendor sees its company's shipments of BOTH departments, never another company's", async () => {
    expect(await lots(await list())).toEqual(["S1", "S2", "S3", "S4", "S6"]);

    mocks.getAuthenticatedUser.mockResolvedValue(otherVendor);
    expect(await lots(await list())).toEqual(["S5"]);
  });

  it("GET orders lists the company's open POs of both departments and nobody else's (policy A)", async () => {
    const mine = (await (await orders()).json()) as Array<{ po_number: string }>;
    expect(mine.map((order) => order.po_number).sort()).toEqual(["PO-A1", "PO-B1"]);

    mocks.getAuthenticatedUser.mockResolvedValue(otherVendor);
    const theirs = (await (await orders()).json()) as Array<{ po_number: string }>;
    expect(theirs.map((order) => order.po_number)).toEqual(["PO-O"]);
  });

  it("OCR finds the candidates of a PO of another department than the Vendor account's (policy A)", async () => {
    const response = await ocr("PO-B1");

    expect(response.status).toBe(200);
    expect(((await response.json()) as { candidates: unknown[] }).candidates).toHaveLength(2);
  });
});

describe("a user without a department scope while departments are ready", () => {
  beforeEach(() => {
    vi.stubEnv("DEPARTMENTS_ENABLED", "true");
    resetDepartmentsFlagForTests();
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "secret.person", name: "Secret", role: "Vendor", vendor: "MB Vendor" });
  });

  it.each([
    ["GET shipments", () => list()],
    ["POST shipments", () => ship([{ itemId: "MB-000001", qty: 4 }])],
    ["POST ocr", () => ocr("PO-B1")],
    ["GET orders", () => orders()],
  ])("%s answers 500 without the username and writes nothing", async (_name, call) => {
    const response = await call();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret.person");
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
    await noRowsWritten();
  });

  it("GET shipments for a Lab user without scope also fails closed", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "secret.person", name: "Secret", role: "Manager" });

    const response = await list();

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret.person");
  });
});

describe("legacy mode (departments off)", () => {
  const legacyVendor = { username: "vendor1", name: "Vendor One", role: "Vendor", vendor: "MB Vendor" };

  it("keeps the original order: a missing PO answers the shelf-life 409 first (no extra PO lookup)", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(legacyVendor);

    const response = await ship([{ itemId: "MB-000001", qty: 4, expDate: inDays(10) }], {}, "PO-NOPE");

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("SHELF_LIFE_BELOW_MINIMUM");
  });

  it("with departments on, the same request answers 'not eligible' instead (documented difference)", async () => {
    const response = await ship([{ itemId: "MB-000001", qty: 4, expDate: inDays(10) }], {}, "PO-NOPE");

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("This order is not eligible for shipment");
  });

  it("a legacy POST still works and leaves the department to the column default", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(legacyVendor);

    const response = await ship([{ itemId: "MB-000001", qty: 4 }]);

    expect(response.status).toBe(201);
    expect(await rows("SELECT department_id FROM shipments")).toEqual([{ department_id: DEPT_A }]);
  });
});
