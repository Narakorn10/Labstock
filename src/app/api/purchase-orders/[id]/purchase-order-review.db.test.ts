import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Real-Postgres checks that Vendor responses and Lab revision reviews are all-or-nothing.

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
import { applyLabReviewDecision, runGuardedPurchaseOrderUpdate } from "@/lib/purchase-order-review";
import { PATCH } from "./route";

const sql = dbSql as unknown as PgliteSql;
const vendor = { username: "vendor1", name: "Vendor One", role: "Vendor", vendor: "Vendor A" };
const manager = { username: "manager1", name: "Manager One", role: "Manager" };
let schemaReady = false;

async function resetDatabase(status: string) {
  if (!schemaReady) {
    await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec(`TRUNCATE purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;`);
  await sql`INSERT INTO purchase_orders (po_number, vendor, status, proposal_origin) VALUES ('PO-1', 'Vendor A', ${status}, 'LAB')`;
  await sql`INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit) VALUES (1, 'X', 'Reagent X', 10, 'box'), (1, 'Y', 'Reagent Y', 5, 'box')`;
}

function patch(user: object, body: Record<string, unknown>) {
  mocks.getAuthenticatedUser.mockResolvedValue(user);
  return PATCH(
    new Request("http://localhost/api/purchase-orders/1", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "1" }) },
  );
}

const items = async () => sql`SELECT item_id, quantity::int AS quantity, revision_qty::int AS revision_qty FROM purchase_order_items ORDER BY item_id`;
const poStatus = async () => (await sql`SELECT status FROM purchase_orders WHERE id = 1`)[0].status;

describe("Vendor revision and Lab review (real Postgres)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a Vendor revision request together with the status change", async () => {
    await resetDatabase("ACKNOWLEDGED");
    const response = await patch(vendor, {
      action: "REQUEST_REVISION",
      note: "short on Y",
      items: [
        { item_id: "X", item_name: "Reagent X", quantity: 10, unit: "box" },
        { item_id: "Y", item_name: "Reagent Y", quantity: 3, unit: "box", revision_reason: "only 3 left" },
      ],
    });

    expect(response.status).toBe(200);
    expect(await poStatus()).toBe("REVISION_REQUESTED");
    expect(await items()).toEqual([
      { item_id: "X", quantity: 10, revision_qty: 10 },
      { item_id: "Y", quantity: 5, revision_qty: 3 },
    ]);
  });

  it("applies revised quantities when the Lab approves the revision", async () => {
    await resetDatabase("REVISION_REQUESTED");
    await sql`UPDATE purchase_order_items SET revision_qty = 3, revision_reason = 'only 3' WHERE item_id = 'Y'`;

    expect((await patch(manager, { action: "APPROVE_REVISION" })).status).toBe(200);
    expect(await poStatus()).toBe("CONFIRMED");
    expect(await items()).toEqual([
      { item_id: "X", quantity: 10, revision_qty: null },
      { item_id: "Y", quantity: 3, revision_qty: null },
    ]);
  });

  it("writes nothing when the PO status changed before the guarded update", async () => {
    await resetDatabase("CONFIRMED");
    const result = await runGuardedPurchaseOrderUpdate(sql as never, 1, "ACKNOWLEDGED", [
      sql`UPDATE purchase_order_items SET revision_qty = 1 WHERE po_id = 1` as never,
      sql`UPDATE purchase_orders SET status = 'REVISION_REQUESTED' WHERE id = 1` as never,
    ]);

    expect(result).toBeNull();
    expect(await poStatus()).toBe("CONFIRMED");
    expect((await items()).every((row) => row.revision_qty === null)).toBe(true);
  });

  it("does not apply a revision twice when the order was already reviewed", async () => {
    await resetDatabase("REVISION_REQUESTED");
    await sql`UPDATE purchase_order_items SET revision_qty = 3 WHERE item_id = 'Y'`;
    const staleRead = { id: 1, status: "REVISION_REQUESTED" };

    expect(await applyLabReviewDecision(sql as never, { po: staleRead, decision: "CONFIRMED", reviewer: "a" })).toBe(true);
    expect(await applyLabReviewDecision(sql as never, { po: staleRead, decision: "REJECTED", reviewer: "b" })).toBe(false);
    expect(await poStatus()).toBe("CONFIRMED");
  });
});
