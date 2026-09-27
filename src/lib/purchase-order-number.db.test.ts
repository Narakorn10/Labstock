import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Real-Postgres check of PO number assignment inside createPurchaseOrderWithAudit.

const mocks = vi.hoisted(() => ({ getSuggestions: vi.fn() }));

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("./purchase-order-suggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./purchase-order-suggestions")>()),
  getPurchaseOrderSuggestions: mocks.getSuggestions,
}));

import dbSql from "./db";
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { calculateSuggestion } from "./purchase-order-suggestions";
import { createPurchaseOrderWithAudit } from "./purchase-order-creation";

const sql = dbSql as unknown as PgliteSql;
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
let schemaReady = false;

const input = {
  user: { username: "admin", name: "Admin", role: "Admin" },
  vendor: "Vendor A",
  items: [{ item_id: "CHEM-R-001", item_name: "Glucose", quantity: 15, unit: "box" }],
  note: null,
  expectedDate: null,
  origin: "LAB" as const,
};

describe("purchase-order number assignment (real Postgres)", () => {
  beforeEach(async () => {
    if (!schemaReady) {
      await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
      schemaReady = true;
    }
    await sql.db.exec(`
      TRUNCATE purchase_order_items, purchase_orders, master_data, lab_profile, users RESTART IDENTITY CASCADE;
      INSERT INTO master_data (item_id, name, unit, vendor) VALUES ('CHEM-R-001', 'Glucose', 'box', 'Vendor A');
      INSERT INTO lab_profile (id, organization_name, department_name) VALUES (1, 'Test Lab', 'Lab Profile Dept');
    `);
    mocks.getSuggestions.mockResolvedValue([calculateSuggestion({
      item_id: "CHEM-R-001", name: "Glucose", unit: "box", vendor: "Vendor A",
      min_threshold: 0, weekly_target: 0, quantity: 0,
      approved_monthly_target_boxes: 30, approved_order_qty_boxes: 15,
      orders_per_month: 2, lead_time_days: 7, safety_stock_boxes: 0,
      min_order_qty_boxes: 1, order_multiple_boxes: 1,
      source_verification_status: "VERIFIED", inventory_lots: [], on_order_lots: [],
      committed_no_eta_qty: 0, dispense_observation_days: 0, dispensed_14d: 0,
    })]);
  });

  it("numbers orders of the same day sequentially", async () => {
    const first = await createPurchaseOrderWithAudit(input);
    await sql`DELETE FROM purchase_order_items`;
    const second = await createPurchaseOrderWithAudit(input);

    expect(first.purchaseOrder.po_number).toBe(`PO-${today}-001`);
    expect(second.purchaseOrder.po_number).toBe(`PO-${today}-002`);
  });

  it("continues after the highest existing number instead of the row count", async () => {
    await sql`INSERT INTO purchase_orders (po_number, vendor, status) VALUES (${`PO-${today}-005`}, 'Vendor B', 'REJECTED')`;

    const created = await createPurchaseOrderWithAudit(input);

    expect(created.purchaseOrder.po_number).toBe(`PO-${today}-006`);
  });

  it("prints the creator's department on the PO, falling back to the Lab profile", async () => {
    await sql`INSERT INTO users (username, name, role, department) VALUES ('admin', 'Admin', 'Admin', 'ห้องปฏิบัติการเคมีคลินิก')`;
    const withDepartment = await createPurchaseOrderWithAudit(input);
    await sql`DELETE FROM purchase_order_items`;
    await sql`UPDATE users SET department = '  ' WHERE username = 'admin'`;
    const blankDepartment = await createPurchaseOrderWithAudit(input);

    expect(withDepartment.purchaseOrder.issuer_department).toBe("ห้องปฏิบัติการเคมีคลินิก");
    expect(blankDepartment.purchaseOrder.issuer_department).toBe("Lab Profile Dept");
  });
});
