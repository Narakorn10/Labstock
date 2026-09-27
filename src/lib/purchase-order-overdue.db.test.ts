import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

const mocks = vi.hoisted(() => ({ recordPurchaseOrderCommunication: vi.fn(), shipmentsEnabled: false }));

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("./po-communication", () => ({ recordPurchaseOrderCommunication: mocks.recordPurchaseOrderCommunication }));
vi.mock("./feature-flags", () => ({
  get SHIPMENTS_ENABLED() {
    return mocks.shipmentsEnabled;
  },
}));

import dbSql from "./db";
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { remindOverduePurchaseOrders } from "./purchase-order-overdue";

const sql = dbSql as unknown as PgliteSql;
let schemaReady = false;

describe("overdue purchase-order reminders (real Postgres)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.shipmentsEnabled = false;
    if (!schemaReady) {
      await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
      schemaReady = true;
    }
    await sql.db.exec(`
      TRUNCATE purchase_order_events, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;
      INSERT INTO purchase_orders (po_number, vendor, status, vendor_response_due_at, expected_date, created_at) VALUES
        ('PO-SILENT',    'V', 'SUBMITTED',          NOW() - INTERVAL '1 day',  NULL, NOW()),
        ('PO-NOT-DUE',   'V', 'ACKNOWLEDGED',       NOW() + INTERVAL '2 days', NULL, NOW()),
        ('PO-LATE',      'V', 'CONFIRMED',          NULL, CURRENT_DATE - 3, NOW()),
        ('PO-PARTIAL',   'V', 'PARTIALLY_RECEIVED', NULL, CURRENT_DATE - 1, NOW()),
        ('PO-IN-TRANSIT','V', 'SHIPPED',            NULL, CURRENT_DATE - 3, NOW()),
        ('PO-CLOSED',    'V', 'CLOSED_SHORT',       NULL, CURRENT_DATE - 3, NOW()),
        ('PO-ON-TIME',   'V', 'CONFIRMED',          NULL, CURRENT_DATE + 3, NOW()),
        ('PO-NO-DUE-OLD','V', 'SUBMITTED',          NULL, NULL, NOW() - INTERVAL '6 days'),
        ('PO-NO-DUE-NEW','V', 'SUBMITTED',          NULL, NULL, NOW() - INTERVAL '4 days');
    `);
  });

  it("reminds only about unconfirmed Vendor orders while shipments are disabled", async () => {
    const reminded = await remindOverduePurchaseOrders();

    expect(reminded.map((order) => [order.po_number, order.event_type])).toEqual([
      ["PO-SILENT", "VENDOR_RESPONSE_OVERDUE"],
      ["PO-NO-DUE-OLD", "VENDOR_RESPONSE_OVERDUE"],
    ]);
    expect(mocks.recordPurchaseOrderCommunication).toHaveBeenCalledTimes(2);
    expect(mocks.recordPurchaseOrderCommunication).toHaveBeenCalledWith(expect.objectContaining({ eventType: "VENDOR_RESPONSE_OVERDUE", source: "SYSTEM" }));
  });

  it("also reminds about late deliveries when shipments are enabled", async () => {
    mocks.shipmentsEnabled = true;

    const reminded = await remindOverduePurchaseOrders();

    expect(reminded.map((order) => [order.po_number, order.event_type])).toEqual([
      ["PO-SILENT", "VENDOR_RESPONSE_OVERDUE"],
      ["PO-LATE", "DELIVERY_OVERDUE"],
      ["PO-PARTIAL", "DELIVERY_OVERDUE"],
      ["PO-NO-DUE-OLD", "VENDOR_RESPONSE_OVERDUE"],
    ]);
  });

  it("does not remind the same order twice within a day", async () => {
    await sql`INSERT INTO purchase_order_events (po_id, po_number, event_type) VALUES (1, 'PO-SILENT', 'VENDOR_RESPONSE_OVERDUE')`;

    const reminded = await remindOverduePurchaseOrders();

    expect(reminded.map((order) => order.po_number)).toEqual(["PO-NO-DUE-OLD"]);
  });

  it("stops reminding an order after three reminders", async () => {
    await sql.db.exec(`
      INSERT INTO purchase_order_events (po_id, po_number, event_type, created_at) VALUES
        (1, 'PO-SILENT', 'VENDOR_RESPONSE_OVERDUE', NOW() - INTERVAL '3 days'),
        (1, 'PO-SILENT', 'VENDOR_RESPONSE_OVERDUE', NOW() - INTERVAL '2 days'),
        (1, 'PO-SILENT', 'VENDOR_RESPONSE_OVERDUE', NOW() - INTERVAL '1 day'),
        (8, 'PO-NO-DUE-OLD', 'VENDOR_RESPONSE_OVERDUE', NOW() - INTERVAL '2 days'),
        (8, 'PO-NO-DUE-OLD', 'VENDOR_RESPONSE_OVERDUE', NOW() - INTERVAL '1 day');
    `);

    const reminded = await remindOverduePurchaseOrders();

    expect(reminded.map((order) => order.po_number)).toEqual(["PO-NO-DUE-OLD"]);
  });
});
