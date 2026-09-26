import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Minimum remaining shelf life on shipment and receipt, against real Postgres.

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

import dbSql from "@/lib/db";
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { daysUntilExpiry } from "@/lib/shelf-life";
import { POST as shipPOST } from "./route";
import { PATCH as receivePATCH } from "./[id]/route";

const sql = dbSql as unknown as PgliteSql;
const vendor = { username: "vendor1", name: "Vendor One", role: "Vendor", vendor: "Vendor A" };
const manager = { username: "manager1", name: "Manager One", role: "Manager" };
const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
let schemaReady = false;

async function resetDatabase(withV26: boolean) {
  if (!schemaReady) {
    await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec(`
    ALTER TABLE master_data DROP COLUMN IF EXISTS min_shelf_life_days;
    ALTER TABLE shipments DROP COLUMN IF EXISTS shelf_life_override_reason;
    TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders, inventory, logs, master_data RESTART IDENTITY CASCADE;
    INSERT INTO master_data (item_id, name, unit, vendor) VALUES ('X', 'Reagent X', 'box', 'Vendor A');
    INSERT INTO purchase_orders (po_number, vendor, status) VALUES ('PO-1', 'Vendor A', 'CONFIRMED');
    INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit) VALUES (1, 'X', 'Reagent X', 10, 'box');
  `);
  if (withV26) {
    // Same DDL as upgrade_v26_min_shelf_life.sql
    await sql.db.exec(`
      ALTER TABLE master_data ADD COLUMN IF NOT EXISTS min_shelf_life_days INTEGER;
      ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shelf_life_override_reason TEXT;
      UPDATE master_data SET min_shelf_life_days = 90 WHERE item_id = 'X';
    `);
  }
}

function ship(expDate: string) {
  mocks.getAuthenticatedUser.mockResolvedValue(vendor);
  return shipPOST(new Request("http://localhost/api/vendor/shipments", {
    method: "POST",
    body: JSON.stringify({ poNumber: "PO-1", referenceNo: "DN-1", items: [{ itemId: "X", lotNo: "L1", expDate, qty: 10 }] }),
  }));
}

function receive(body: Record<string, unknown> = {}) {
  mocks.getAuthenticatedUser.mockResolvedValue(manager);
  return receivePATCH(
    new Request("http://localhost/api/vendor/shipments/1", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "1" }) },
  );
}

describe("minimum remaining shelf life (real Postgres)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts whole days to expiry", () => {
    expect(daysUntilExpiry("2026-01-31", new Date("2026-01-01T15:00:00Z"))).toBe(30);
  });

  it("refuses a Vendor shipment below the minimum", async () => {
    await resetDatabase(true);
    const response = await ship(inDays(30));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("SHELF_LIFE_BELOW_MINIMUM");
    expect((await sql`SELECT COUNT(*)::int AS n FROM shipments`)[0].n).toBe(0);
  });

  it("accepts a Vendor shipment that meets the minimum", async () => {
    await resetDatabase(true);
    expect((await ship(inDays(120))).status).toBe(201);
  });

  it("makes the Lab give a reason to accept a short-dated lot, and records it", async () => {
    await resetDatabase(false);
    await ship(inDays(30));
    await sql.db.exec(`
      ALTER TABLE master_data ADD COLUMN min_shelf_life_days INTEGER;
      ALTER TABLE shipments ADD COLUMN shelf_life_override_reason TEXT;
      UPDATE master_data SET min_shelf_life_days = 90 WHERE item_id = 'X';
    `);

    expect((await receive()).status).toBe(409);
    expect((await sql`SELECT COUNT(*)::int AS n FROM inventory`)[0].n).toBe(0);

    expect((await receive({ shelf_life_override_reason: "urgent, used within 2 weeks" })).status).toBe(200);
    const saved = await sql`SELECT status, shelf_life_override_reason FROM shipments WHERE id = 1`;
    expect(saved[0]).toEqual({ status: "Received", shelf_life_override_reason: "urgent, used within 2 weeks" });
  });

  it("lets the Lab reject a short-dated lot without a reason", async () => {
    await resetDatabase(false);
    await ship(inDays(30));
    await sql.db.exec(`
      ALTER TABLE master_data ADD COLUMN min_shelf_life_days INTEGER;
      ALTER TABLE shipments ADD COLUMN shelf_life_override_reason TEXT;
      UPDATE master_data SET min_shelf_life_days = 90 WHERE item_id = 'X';
    `);

    expect((await receive({ accepted_qty: 0, rejected_qty: 10, rejection_reason: "short dated" })).status).toBe(200);
  });

  it("works unchanged before upgrade_v26 is applied", async () => {
    await resetDatabase(false);
    expect((await ship(inDays(5))).status).toBe(201);
    expect((await receive()).status).toBe(200);
  });
});
