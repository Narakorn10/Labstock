import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): unknown;
    transaction: ReturnType<typeof vi.fn>;
  };
  sql.transaction = vi.fn();
  return { sql, getSuggestions: vi.fn() };
});

vi.mock("./db", () => ({ default: mocks.sql }));
vi.mock("./purchase-order-suggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./purchase-order-suggestions")>()),
  getPurchaseOrderSuggestions: mocks.getSuggestions,
}));

import { calculateSuggestion } from "./purchase-order-suggestions";
import { createPurchaseOrderWithAudit } from "./purchase-order-creation";

function currentSuggestion() {
  return calculateSuggestion({
    item_id: "CHEM-R-001", name: "Glucose", unit: "box", vendor: "Vendor A",
    min_threshold: 0, weekly_target: 0, quantity: 0,
    approved_monthly_target_boxes: 30, approved_order_qty_boxes: 15,
    orders_per_month: 2, lead_time_days: 7, safety_stock_boxes: 0,
    min_order_qty_boxes: 1, order_multiple_boxes: 1,
    source_verification_status: "VERIFIED", inventory_lots: [], on_order_lots: [],
    committed_no_eta_qty: 0, dispensed_14d: 0, dispense_observation_days: 0,
  }, new Date("2026-08-10T00:00:00.000Z"));
}

const input = {
  user: { username: "admin", name: "Admin", role: "Admin" },
  vendor: "Vendor A",
  items: [{ item_id: "CHEM-R-001", item_name: "Glucose", quantity: 15, unit: "box" }],
  note: null,
  expectedDate: null,
  origin: "LAB" as const,
};

describe("purchase-order concurrency guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSuggestions.mockResolvedValue([currentSuggestion()]);
  });

  it("locks item IDs and checks the pending-PO snapshot before inserting", async () => {
    mocks.sql.transaction.mockResolvedValue([[], [], [{ purchase_order: { id: 1 }, items: [] }]]);
    await createPurchaseOrderWithAudit(input);

    const queries = mocks.sql.transaction.mock.calls[0][0] as Array<{ strings: TemplateStringsArray }>;
    expect(queries).toHaveLength(3);
    expect(Array.from(queries[0].strings).join(" ")).toContain("pg_advisory_xact_lock");
    expect(Array.from(queries[1].strings).join(" ")).toContain("pg_advisory_xact_lock");
    const insertSql = Array.from(queries[2].strings).join(" ");
    expect(insertSql).toContain("po_seq");
    expect(insertSql).toContain("stale_items");
    expect(insertSql).toContain("snapshot_on_order_qty");
    expect(insertSql).toContain("snapshot_no_eta_qty");
  });

  it("returns 409 when pending PO state changed after recomputation", async () => {
    mocks.sql.transaction.mockResolvedValue([[], [], [{ purchase_order: null, items: [] }]]);
    await expect(createPurchaseOrderWithAudit(input)).rejects.toMatchObject({ status: 409 });
  });
});
