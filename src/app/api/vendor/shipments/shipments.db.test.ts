import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Runs the real shipment routes against an in-memory Postgres to check the
// purchase-order status after each Vendor shipment and Lab receipt.

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
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { POST as shipPOST } from "./route";
import { PATCH as receivePATCH } from "./[id]/route";

const sql = dbSql as unknown as PgliteSql;
const vendor = { username: "vendor1", name: "Vendor One", role: "Vendor", vendor: "Vendor A" };
const manager = { username: "manager1", name: "Manager One", role: "Manager" };
let schemaReady = false;

async function resetDatabase() {
  if (!schemaReady) {
    await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec(`
    TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders, inventory, logs, master_data RESTART IDENTITY CASCADE;
    INSERT INTO master_data (item_id, name, unit, vendor) VALUES ('X', 'Reagent X', 'box', 'Vendor A'), ('Y', 'Reagent Y', 'box', 'Vendor A');
    INSERT INTO purchase_orders (po_number, vendor, status) VALUES ('PO-1', 'Vendor A', 'CONFIRMED');
    INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit) VALUES (1, 'X', 'Reagent X', 10, 'box');
  `);
}

function ship(items: Array<{ itemId: string; qty: number }>, reference = "DN-1") {
  mocks.getAuthenticatedUser.mockResolvedValue(vendor);
  return shipPOST(new Request("http://localhost/api/vendor/shipments", {
    method: "POST",
    body: JSON.stringify({
      poNumber: "PO-1",
      referenceNo: reference,
      items: items.map((item, index) => ({ itemId: item.itemId, lotNo: `L${reference}-${index}`, expDate: "2099-01-01", qty: item.qty })),
    }),
  }));
}

function receive(shipmentId: number, body: Record<string, unknown> = {}) {
  mocks.getAuthenticatedUser.mockResolvedValue(manager);
  return receivePATCH(
    new Request(`http://localhost/api/vendor/shipments/${shipmentId}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: String(shipmentId) }) },
  );
}

async function poState() {
  const rows = await sql`SELECT status, received_at IS NOT NULL AS has_received_at FROM purchase_orders WHERE po_number = 'PO-1'`;
  return rows[0] as { status: string; has_received_at: boolean };
}

describe("purchase-order status through shipment and receipt (real Postgres)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
  });

  it("marks the order SHIPPED when the Vendor ships the full quantity", async () => {
    expect((await ship([{ itemId: "X", qty: 10 }])).status).toBe(201);
    expect((await poState()).status).toBe("SHIPPED");
  });

  it("marks the order PARTIALLY_SHIPPED after a partial shipment", async () => {
    expect((await ship([{ itemId: "X", qty: 4 }])).status).toBe(201);
    expect((await poState()).status).toBe("PARTIALLY_SHIPPED");
  });

  it("marks the order RECEIVED with a received_at time once everything is accepted", async () => {
    await ship([{ itemId: "X", qty: 10 }]);
    expect((await receive(1)).status).toBe(200);

    expect(await poState()).toEqual({ status: "RECEIVED", has_received_at: true });
    const stock = await sql`SELECT SUM(quantity)::int AS qty FROM inventory WHERE item_id = 'X'`;
    expect(stock[0].qty).toBe(10);
  });

  it("keeps the order PARTIALLY_RECEIVED when part of the delivery is rejected", async () => {
    await ship([{ itemId: "X", qty: 10 }]);
    expect((await receive(1, { accepted_qty: 8, rejected_qty: 2, rejection_reason: "broken" })).status).toBe(200);

    expect(await poState()).toEqual({ status: "PARTIALLY_RECEIVED", has_received_at: false });
  });

  it("returns the order to CONFIRMED when its only in-transit shipment is cancelled", async () => {
    await ship([{ itemId: "X", qty: 10 }]);
    expect((await receive(1, { action: "cancel" })).status).toBe(200);

    expect((await poState()).status).toBe("CONFIRMED");
  });
});
