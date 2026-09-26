import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Reagents without an enabled order policy: the Lab reported it could not add them to an
// order after the auto-suggestion. Runs the real suggestion query and PO creation on Postgres.

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  recordPurchaseOrderCommunication: vi.fn(),
}));

// "./db" (used by the lib) and "@/lib/db" (used by the route) resolve to the same module.
vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/po-communication", () => ({ recordPurchaseOrderCommunication: mocks.recordPurchaseOrderCommunication }));

import dbSql from "@/lib/db";
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { getPurchaseOrderSuggestions } from "./purchase-order-suggestions";
import { createPurchaseOrderWithAudit } from "./purchase-order-creation";
import { POST } from "@/app/api/purchase-orders/route";

const sql = dbSql as unknown as PgliteSql;
const admin = { username: "admin", name: "Admin", role: "Admin" };
let schemaReady = false;

const order = (items: Array<Record<string, unknown>>) => ({
  user: admin,
  vendor: "Vendor A",
  items: items as never,
  note: null,
  expectedDate: null,
  origin: "LAB" as const,
});

beforeEach(async () => {
  vi.clearAllMocks();
  if (!schemaReady) {
    await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec(`
    TRUNCATE purchase_order_items, purchase_orders, reagent_order_policy, master_data, lab_profile, logs, inventory RESTART IDENTITY CASCADE;
    INSERT INTO lab_profile (id, organization_name) VALUES (1, 'Test Lab');
    INSERT INTO master_data (item_id, name, unit, vendor, min_threshold, weekly_target, is_active) VALUES
      ('POL-1',  'Policy reagent',       'box', 'Vendor A', 2, 1, TRUE),
      ('NOPOL-1','No-policy reagent',    'box', 'Vendor A', 2, 1, TRUE),
      ('OFF-1',  'Inactive reagent',     'box', 'Vendor A', 2, 1, FALSE),
      ('OTHER-1','Other vendor reagent', 'box', 'Vendor B', 2, 1, TRUE);
    INSERT INTO reagent_order_policy (item_id, approved_monthly_target_boxes, approved_order_qty_boxes) VALUES ('POL-1', 10, 5);
  `);
});

describe("suggestion query and reagents without an order policy (real Postgres)", () => {
  it("keeps auto-suggest policy-only, but search finds the no-policy reagent flagged for review", async () => {
    const auto = await getPurchaseOrderSuggestions(sql as never, { vendor: "Vendor A", includeAll: true });
    expect(auto.map((row) => row.item_id)).toEqual(["POL-1"]);

    const search = await getPurchaseOrderSuggestions(sql as never, { vendor: "Vendor A", includeAll: true, includeUnconfigured: true });
    const noPolicy = search.find((row) => row.item_id === "NOPOL-1");
    expect(noPolicy).toMatchObject({ policy_configured: false, auto_selectable: false });
    expect(noPolicy?.review_reasons).toContain("NO_ORDER_POLICY");
    expect(search.find((row) => row.item_id === "POL-1")?.policy_configured).toBe(true);
  });

  it("returns every requested item even when the default page size would cut it off", async () => {
    const rows = await getPurchaseOrderSuggestions(sql as never, { vendor: "Vendor A", itemIds: ["POL-1"], includeAll: true, limit: 1 });
    expect(rows.map((row) => row.item_id)).toEqual(["POL-1"]);
  });
});

describe("large Vendor catalogue (PCL has 116 active reagents in production)", () => {
  beforeEach(async () => {
    // 120 reagents for Vendor A; the 40 with the MOST stock still need ordering because of heavy use,
    // so a lowest-stock-first row cap would have hidden them.
    await sql.db.exec(`
      INSERT INTO master_data (item_id, name, unit, vendor, min_threshold, weekly_target, is_active)
      SELECT 'BIG-' || LPAD(g::text, 3, '0'), 'Big reagent ' || g, 'box', 'Vendor A', 0, 0, TRUE FROM generate_series(1, 120) g;
      INSERT INTO reagent_order_policy (item_id, approved_monthly_target_boxes, approved_order_qty_boxes, safety_stock_boxes, review_days)
      SELECT 'BIG-' || LPAD(g::text, 3, '0'), CASE WHEN g > 80 THEN 3000 ELSE 1 END, 5, 0, 15 FROM generate_series(1, 120) g;
      INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on)
      SELECT 'BIG-' || LPAD(g::text, 3, '0'), 'L', CURRENT_DATE + 400, CASE WHEN g > 80 THEN 200 ELSE 50 END, CURRENT_DATE FROM generate_series(1, 120) g;
    `);
  });

  it("auto-suggest evaluates every reagent, even when the caller passes a small limit", async () => {
    const suggested = await getPurchaseOrderSuggestions(sql as never, { vendor: "Vendor A", limit: 30 });
    const bigSuggested = suggested.filter((row) => row.item_id.startsWith("BIG-"));
    expect(bigSuggested).toHaveLength(40);
    expect(bigSuggested.every((row) => Number(row.item_id.slice(4)) > 80)).toBe(true);
  });

  it("browsing the catalogue without a keyword can list the whole Vendor", async () => {
    const browse = await getPurchaseOrderSuggestions(sql as never, { vendor: "Vendor A", includeAll: true, includeUnconfigured: true, limit: 300 });
    expect(browse.filter((row) => row.item_id.startsWith("BIG-"))).toHaveLength(120);
  });

  it("creates an order for the reagent with the most stock", async () => {
    const created = await createPurchaseOrderWithAudit(order([
      { item_id: "BIG-120", item_name: "Big reagent 120", quantity: 5, unit: "box", selected_basis: "POLICY" },
    ]));
    expect(created.purchaseOrder.po_number).toBeTruthy();
  });
});

describe("creating an order with a reagent that has no order policy (real Postgres)", () => {
  it("requires a reason", async () => {
    await expect(createPurchaseOrderWithAudit(order([
      { item_id: "NOPOL-1", item_name: "No-policy reagent", quantity: 3, unit: "box", selected_basis: "DYNAMIC" },
    ]))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("ยังไม่ได้ตั้งนโยบายสั่งซื้อ") });
  });

  it("creates the order as a manual line with the reason and the NO_ORDER_POLICY flag", async () => {
    const created = await createPurchaseOrderWithAudit(order([
      { item_id: "POL-1", item_name: "Policy reagent", quantity: 5, unit: "box", selected_basis: "POLICY" },
      { item_id: "NOPOL-1", item_name: "No-policy reagent", quantity: 3, unit: "box", override_reason: "new test method starts next week" },
    ]));

    const lines = await sql`
      SELECT item_id, selected_basis, override_reason, calculation_snapshot->'review_reasons' AS reasons
      FROM purchase_order_items WHERE po_id = ${created.purchaseOrder.id} ORDER BY item_id
    `;
    expect(lines[0]).toMatchObject({ item_id: "NOPOL-1", selected_basis: "MANUAL", override_reason: "new test method starts next week" });
    expect(lines[0].reasons).toContain("NO_ORDER_POLICY");
    expect(lines[1]).toMatchObject({ item_id: "POL-1", selected_basis: "POLICY" });
  });

  it("names the item when it is inactive or belongs to another vendor", async () => {
    await expect(createPurchaseOrderWithAudit(order([
      { item_id: "OFF-1", item_name: "Inactive reagent", quantity: 1, unit: "box", override_reason: "x" },
    ]))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Inactive reagent") });
    await expect(createPurchaseOrderWithAudit(order([
      { item_id: "OTHER-1", item_name: "Other vendor reagent", quantity: 1, unit: "box", override_reason: "x" },
    ]))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Vendor A") });
  });
});

describe("POST /api/purchase-orders item validation messages", () => {
  const post = (items: unknown) => {
    mocks.getAuthenticatedUser.mockResolvedValue(admin);
    return POST(new Request("http://localhost/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({ vendor: "Vendor A", items }),
    }));
  };

  it("says which reagent is duplicated instead of a generic error", async () => {
    const response = await post([
      { item_id: "POL-1", item_name: "Policy reagent", quantity: 5, unit: "box" },
      { item_id: "POL-1", item_name: "Policy reagent", quantity: 2, unit: "box", selected_basis: "MANUAL", override_reason: "x" },
    ]);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("น้ำยาซ้ำ: Policy reagent");
  });

  it("creates the order through the route when a no-policy reagent has a reason", async () => {
    const response = await post([
      { item_id: "NOPOL-1", item_name: "No-policy reagent", quantity: 2, unit: "box", selected_basis: "MANUAL", override_reason: "urgent add-on" },
    ]);
    expect(response.status).toBe(201);
  });
});
