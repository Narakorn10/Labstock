import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

const mocks = vi.hoisted(() => ({ recordPurchaseOrderCommunication: vi.fn() }));

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("./po-communication", () => ({ recordPurchaseOrderCommunication: mocks.recordPurchaseOrderCommunication }));

import dbSql from "./db";
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { remindOverduePurchaseOrders } from "./purchase-order-overdue";

const sql = dbSql as unknown as PgliteSql;
let schemaReady = false;

describe("overdue purchase-order reminders (real Postgres)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    if (!schemaReady) {
      await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
      schemaReady = true;
    }
    await sql.db.exec(`
      TRUNCATE purchase_order_events, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;
      INSERT INTO purchase_orders (po_number, vendor, status, vendor_response_due_at, expected_date) VALUES
        ('PO-SILENT',    'V', 'SUBMITTED',          NOW() - INTERVAL '1 day',  NULL),
        ('PO-NOT-DUE',   'V', 'ACKNOWLEDGED',       NOW() + INTERVAL '2 days', NULL),
        ('PO-LATE',      'V', 'CONFIRMED',          NULL, CURRENT_DATE - 3),
        ('PO-PARTIAL',   'V', 'PARTIALLY_RECEIVED', NULL, CURRENT_DATE - 1),
        ('PO-IN-TRANSIT','V', 'SHIPPED',            NULL, CURRENT_DATE - 3),
        ('PO-CLOSED',    'V', 'CLOSED_SHORT',       NULL, CURRENT_DATE - 3),
        ('PO-ON-TIME',   'V', 'CONFIRMED',          NULL, CURRENT_DATE + 3);
    `);
  });

  it("reminds the Lab about late Vendor responses and late deliveries only", async () => {
    const reminded = await remindOverduePurchaseOrders();

    expect(reminded.map((order) => [order.po_number, order.event_type])).toEqual([
      ["PO-SILENT", "VENDOR_RESPONSE_OVERDUE"],
      ["PO-LATE", "DELIVERY_OVERDUE"],
      ["PO-PARTIAL", "DELIVERY_OVERDUE"],
    ]);
    expect(mocks.recordPurchaseOrderCommunication).toHaveBeenCalledTimes(3);
    expect(mocks.recordPurchaseOrderCommunication).toHaveBeenCalledWith(expect.objectContaining({ eventType: "VENDOR_RESPONSE_OVERDUE", source: "SYSTEM" }));
  });

  it("does not remind the same order twice within a day", async () => {
    await sql`INSERT INTO purchase_order_events (po_id, po_number, event_type) VALUES (1, 'PO-SILENT', 'VENDOR_RESPONSE_OVERDUE')`;
    await sql`INSERT INTO purchase_order_events (po_id, po_number, event_type, created_at) VALUES (3, 'PO-LATE', 'DELIVERY_OVERDUE', NOW() - INTERVAL '2 days')`;

    const reminded = await remindOverduePurchaseOrders();

    expect(reminded.map((order) => order.po_number)).toEqual(["PO-LATE", "PO-PARTIAL"]);
  });
});
