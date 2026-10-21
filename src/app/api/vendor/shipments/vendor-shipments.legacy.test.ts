import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PgliteSql } from "@/test/pglite-sql";

// With DEPARTMENTS_ENABLED off (scope { mode: "legacy" }), the Vendor shipment routes must send EXACTLY the statements they
// sent before the department change (text, params, statement count): GET shipments (Vendor and Manager), POST shipments
// (shelf-life lookup + the 2 transaction statements, with and without clientRequestId), OCR (supplied text, order not found)
// and GET orders. The baseline JSON was captured from the ORIGINAL code (origin/main 3f833f1), before any route was touched.
//
// LIMIT: this proves identity only through the PGlite shim (createPgliteSql), which composes nested sql fragments itself.
// It was never run against Neon: check the scoped queries on real Neon at rehearsal before enabling the flag.
//
// To regenerate the baseline on purpose (never done silently): UPDATE_VENDOR_SHIPMENTS_BASELINE=1 npx vitest run <this file>.

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
import { GET as shipmentsGET, POST as shipmentsPOST } from "./route";
import { POST as ocrPOST } from "./ocr/route";
import { GET as ordersGET } from "./orders/route";

const sql = dbSql as unknown as PgliteSql;
const BASELINE_PATH = path.resolve(process.cwd(), "src/app/api/vendor/shipments/vendor-shipments.legacy-baseline.json");
const vendor = { username: "vendor1", name: "Vendor One", role: "Vendor", vendor: "Vendor A" };
const manager = { username: "manager1", name: "Manager One", role: "Manager" };

type Captured = Array<{ text: string; params: unknown[] }>;

// Records every statement the route sends: plain queries are seen when PGlite executes them, transactions are replaced by a canned answer.
async function capture(run: () => Promise<Response>, rows: Array<Record<string, unknown>>, transactionResult: Array<Array<Record<string, unknown>>> = []) {
  const captured: Captured = [];
  vi.spyOn(sql.db, "query").mockImplementation((async (text: string, params: unknown[]) => {
    captured.push({ text, params });
    return { rows };
  }) as never);
  vi.spyOn(sql, "transaction").mockImplementation((async (queries: unknown) => {
    for (const query of queries as Captured) captured.push({ text: query.text, params: query.params });
    return transactionResult;
  }) as never);
  const response = await run();
  vi.restoreAllMocks();
  return { captured, status: response.status };
}

const post = (extra: Record<string, unknown> = {}) => () => {
  mocks.getAuthenticatedUser.mockResolvedValue(vendor);
  return shipmentsPOST(new Request("http://localhost/api/vendor/shipments", {
    method: "POST",
    body: JSON.stringify({
      poNumber: "PO-1", referenceNo: "DN-1", trackingNo: "TRK", trackingProvider: "Kerry", deliveryDate: "2026-08-12",
      items: [{ itemId: "X", lotNo: "L1", expDate: "2099-01-01", qty: 4 }], ...extra,
    }),
  }));
};
const savedRows = [[{ batch_id: 1, shipment_count: 1, status: "PARTIALLY_SHIPPED", po_id: 1, duplicate: false }], [{ status: "PARTIALLY_SHIPPED" }]];
const ocr = (body: Record<string, unknown>) => () => {
  mocks.getAuthenticatedUser.mockResolvedValue(vendor);
  return ocrPOST(new Request("http://localhost/api/vendor/shipments/ocr", { method: "POST", body: JSON.stringify(body) }));
};
const candidateRows = [{ item_id: "X", item_name: "Reagent X", quantity: 10, remaining_qty: 10, aliases: [] }];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-10T03:04:05.678Z"));
});

afterAll(async () => {
  vi.useRealTimers();
  await sql.db.close();
});

describe("Vendor shipment routes with departments off (legacy)", () => {
  it("sends exactly the pre-change statements", async () => {
    const results = {
      getVendor: await capture(async () => { mocks.getAuthenticatedUser.mockResolvedValue(vendor); return shipmentsGET(new Request("http://localhost/api/vendor/shipments")); }, []),
      getManager: await capture(async () => { mocks.getAuthenticatedUser.mockResolvedValue(manager); return shipmentsGET(new Request("http://localhost/api/vendor/shipments")); }, []),
      postWithoutClientRequestId: await capture(post(), [], savedRows),
      postWithClientRequestId: await capture(post({ clientRequestId: "client-req-1" }), [], savedRows),
      ocrWithText: await capture(ocr({ poNumber: "PO-1", text: "X lot L1 qty 4" }), candidateRows),
      ocrNotFound: await capture(ocr({ poNumber: "PO-1", text: "X" }), []),
      getOrders: await capture(async () => { mocks.getAuthenticatedUser.mockResolvedValue(vendor); return ordersGET(new Request("http://localhost/api/vendor/shipments/orders")); }, []),
    };
    // Sanity: every call reached the database (status is not the point, but a wrong one means the capture is meaningless).
    expect(Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.status]))).toEqual({
      getVendor: 200, getManager: 200, postWithoutClientRequestId: 201, postWithClientRequestId: 201,
      ocrWithText: 200, ocrNotFound: 400, getOrders: 200,
    });
    const actual = Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.captured]));
    if (process.env.UPDATE_VENDOR_SHIPMENTS_BASELINE === "1") writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as typeof actual;

    expect(Object.keys(actual)).toEqual(Object.keys(baseline));
    for (const key of Object.keys(baseline)) {
      expect(actual[key]).toHaveLength(baseline[key].length);
      actual[key].forEach((query, index) => {
        expect(query.text, `${key}[${index}] text`).toBe(baseline[key][index].text);
        expect(query.params, `${key}[${index}] params`).toEqual(baseline[key][index].params);
        expect(query.text).not.toMatch(/department_id/i);
      });
    }
    expect(actual.postWithoutClientRequestId).toHaveLength(3); // shelf-life lookup + 2 transaction statements
    expect(actual.postWithClientRequestId).toHaveLength(3);
    expect(actual).toEqual(baseline);
  });
});
