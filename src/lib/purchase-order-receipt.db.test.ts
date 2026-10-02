import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import { PURCHASE_ORDER_TEST_SCHEMA } from "@/test/pglite-sql";
import { confirmLabReceipt } from "./purchase-order-receipt";

const sql = dbSql as unknown as PgliteSql;
let schemaReady = false;

type Line = { id: number; received_qty: string | null; accepted_qty: string | null };

async function loadPo(poNumber: string) {
  const [po] = await sql`SELECT id, po_number, status FROM purchase_orders WHERE po_number = ${poNumber}`;
  return { id: Number(po.id), po_number: String(po.po_number), status: String(po.status) };
}

async function linesOf(poId: number) {
  return await sql`SELECT id, received_qty, accepted_qty FROM purchase_order_items WHERE po_id = ${poId} ORDER BY id` as Line[];
}

describe("Lab confirms receipt of a purchase order (real Postgres)", () => {
  beforeEach(async () => {
    if (!schemaReady) {
      await sql.db.exec(PURCHASE_ORDER_TEST_SCHEMA);
      schemaReady = true;
    }
    await sql.db.exec(`
      TRUNCATE shipments, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;
      INSERT INTO purchase_orders (po_number, vendor, status) VALUES
        ('PO-1', 'V', 'CONFIRMED'),
        ('PO-SILENT', 'V', 'SUBMITTED'),
        ('PO-DONE', 'V', 'CANCELLED'),
        ('PO-PART', 'V', 'PARTIALLY_RECEIVED');
      INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, received_qty, accepted_qty) VALUES
        (1, 'A', 'Reagent A', 10, NULL, 0),
        (1, 'B', 'Reagent B', 4, NULL, NULL),
        (2, 'A', 'Reagent A', 3, NULL, 0),
        (3, 'A', 'Reagent A', 2, NULL, 0),
        (4, 'A', 'Reagent A', 10, 6, 6),
        (4, 'B', 'Reagent B', 5, NULL, 0);
    `);
  });

  it("marks every line received and closes the order when all lines are ticked", async () => {
    const result = await confirmLabReceipt(sql as never, { po: await loadPo("PO-1"), poItemIds: [1, 2] });

    expect(result).toMatchObject({ ok: true, status: "RECEIVED" });
    expect(result.ok && result.items.map((item) => [item.item_id, item.qty])).toEqual([["A", 10], ["B", 4]]);
    const lines = await linesOf(1);
    expect(lines.map((line) => [Number(line.received_qty), Number(line.accepted_qty)])).toEqual([[10, 10], [4, 4]]);
    const [po] = await sql`SELECT status, received_at FROM purchase_orders WHERE id = 1`;
    expect(po.received_at).not.toBeNull();
  });

  it("leaves the order partially received when only some lines are ticked, then closes it on a second round", async () => {
    const first = await confirmLabReceipt(sql as never, { po: await loadPo("PO-1"), poItemIds: [1] });
    expect(first).toMatchObject({ ok: true, status: "PARTIALLY_RECEIVED" });

    const second = await confirmLabReceipt(sql as never, { po: await loadPo("PO-1"), poItemIds: [2] });
    expect(second).toMatchObject({ ok: true, status: "RECEIVED" });
  });

  it("only adds the outstanding amount on a partly received line", async () => {
    const result = await confirmLabReceipt(sql as never, { po: await loadPo("PO-PART"), poItemIds: [5] });

    expect(result).toMatchObject({ ok: true, status: "PARTIALLY_RECEIVED" });
    expect(result.ok && result.items[0].qty).toBe(4);
    const [line] = await linesOf(4);
    expect([Number(line.received_qty), Number(line.accepted_qty)]).toEqual([10, 10]);
  });

  it("accepts an order the Vendor never answered", async () => {
    const result = await confirmLabReceipt(sql as never, { po: await loadPo("PO-SILENT"), poItemIds: [3] });

    expect(result).toMatchObject({ ok: true, status: "RECEIVED" });
  });

  it("rejects a line that was already received and changes nothing", async () => {
    await confirmLabReceipt(sql as never, { po: await loadPo("PO-1"), poItemIds: [1] });
    const before = await linesOf(1);

    const again = await confirmLabReceipt(sql as never, { po: await loadPo("PO-1"), poItemIds: [1, 2] });

    expect(again).toMatchObject({ ok: false, httpStatus: 409 });
    expect(await linesOf(1)).toEqual(before);
  });

  it("rejects a closed order", async () => {
    const result = await confirmLabReceipt(sql as never, { po: await loadPo("PO-DONE"), poItemIds: [4] });

    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });

  it("rejects a line from another order", async () => {
    const result = await confirmLabReceipt(sql as never, { po: await loadPo("PO-1"), poItemIds: [3] });

    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect((await linesOf(2))[0].accepted_qty).toBe("0");
  });

  it("rejects an empty or invalid selection", async () => {
    const po = await loadPo("PO-1");
    expect(await confirmLabReceipt(sql as never, { po, poItemIds: [] })).toMatchObject({ ok: false, httpStatus: 400 });
    expect(await confirmLabReceipt(sql as never, { po, poItemIds: ["x"] })).toMatchObject({ ok: false, httpStatus: 400 });
    expect(await confirmLabReceipt(sql as never, { po, poItemIds: undefined })).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("refuses while a Vendor shipment for the order is still in transit", async () => {
    await sql`INSERT INTO shipments (po_number, item_id, quantity, status) VALUES ('PO-1', 'A', 10, 'In Transit')`;

    const result = await confirmLabReceipt(sql as never, { po: await loadPo("PO-1"), poItemIds: [1] });

    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(Number((await linesOf(1))[0].accepted_qty)).toBe(0);
  });

  it("refuses when the order status changed after it was loaded", async () => {
    const stale = await loadPo("PO-1");
    await sql`UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = 1`;

    const result = await confirmLabReceipt(sql as never, { po: stale, poItemIds: [1] });

    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(Number((await linesOf(1))[0].accepted_qty)).toBe(0);
  });
});
