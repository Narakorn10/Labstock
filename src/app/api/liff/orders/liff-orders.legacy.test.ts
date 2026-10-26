import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PgliteSql } from "@/test/pglite-sql";

// With DEPARTMENTS_ENABLED off, the 4 LIFF ordering routes (bootstrap, catalog/search, POST orders, PATCH orders/[id]) must send
// EXACTLY the statements they sent before the department change (text, params, order, count), answer the same status and body,
// and pass the same arguments to the helpers that are mocked here (getPurchaseOrderSuggestions options + scope,
// recordPurchaseOrderCommunication). The auth statements of line-liff-ordering.ts are part of the baseline too.
// The baseline JSON was captured from the ORIGINAL code (main 96093b8), before any src file was touched.
//
// Not mocked on purpose: line-liff-ordering, line-liff-auth (only verifyLineIdToken is replaced) and createPurchaseOrderWithAudit,
// so the SQL of the route AND of the PO creation transaction is captured. The SQL inside getPurchaseOrderSuggestions is not
// captured here (it is mocked); purchase-order-suggestions.dept.db.test.ts covers it.
//
// LIMIT: this proves identity only through the PGlite shim (createPgliteSql), which composes nested sql fragments itself.
// It was never run against Neon: check the scoped queries on real Neon at rehearsal before enabling the flag.
//
// To regenerate the baseline on purpose (never done silently): UPDATE_LIFF_ORDERS_BASELINE=1 npx vitest run <this file>.

const mocks = vi.hoisted(() => ({
  verifyLineIdToken: vi.fn(),
  recordPurchaseOrderCommunication: vi.fn(),
  getPurchaseOrderSuggestions: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/line-liff-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/line-liff-auth")>()),
  verifyLineIdToken: mocks.verifyLineIdToken,
}));
vi.mock("@/lib/po-communication", () => ({ recordPurchaseOrderCommunication: mocks.recordPurchaseOrderCommunication }));
vi.mock("@/lib/purchase-order-suggestions", () => ({ getPurchaseOrderSuggestions: mocks.getPurchaseOrderSuggestions }));

import dbSql from "@/lib/db";
import { POST as bootstrapPOST } from "./bootstrap/route";
import { POST as catalogPOST } from "./catalog/search/route";
import { POST as ordersPOST } from "./route";
import { PATCH as orderPATCH } from "./[id]/route";

const sql = dbSql as unknown as PgliteSql;
const BASELINE_PATH = path.resolve(process.cwd(), "src/app/api/liff/orders/liff-orders.legacy-baseline.json");

type Row = Record<string, unknown>;
type Captured = Array<{ text: string; params: unknown[] }>;
type Options = {
  /** Row of users the LINE id maps to (undefined = default Manager, [] = not linked). */
  userRows?: Row[];
  lineColumn?: boolean;
  liffRequestColumn?: boolean;
  /** Answers for the route's own statements, by statement text (undefined = empty result). */
  rows?: (text: string) => Row[] | undefined;
  transactionResult?: Row[][];
};

const manager: Row = { username: "mgr1", name: "Manager One", role: "Manager", vendor: null, account_status: "active" };
const idToken = "id-token-1";

function answer(text: string, options: Options): Row[] {
  if (/column_name = 'line_user_id'/.test(text)) return [{ exists: options.lineColumn !== false }];
  if (/column_name = 'account_status'/.test(text)) return [{ exists: true }];
  if (/column_name = 'liff_request_id'/.test(text)) return [{ exists: options.liffRequestColumn !== false }];
  if (/FROM users\s+WHERE line_user_id/.test(text)) return options.userRows ?? [manager];
  return options.rows?.(text) ?? [];
}

// Records every statement the route sends: plain queries are seen when PGlite executes them, transactions are replaced by a canned answer.
async function capture(run: () => Promise<Response>, options: Options = {}) {
  const captured: Captured = [];
  vi.spyOn(sql.db, "query").mockImplementation((async (text: string, params: unknown[]) => {
    captured.push({ text, params });
    return { rows: answer(text, options) };
  }) as never);
  vi.spyOn(sql, "transaction").mockImplementation((async (queries: unknown) => {
    for (const query of queries as Captured) captured.push({ text: query.text, params: query.params });
    return options.transactionResult ?? [];
  }) as never);
  mocks.getPurchaseOrderSuggestions.mockClear();
  mocks.recordPurchaseOrderCommunication.mockClear();
  const response = await run();
  vi.restoreAllMocks();
  return {
    status: response.status,
    body: JSON.parse(await response.text()) as unknown,
    statements: captured,
    // The first argument of getPurchaseOrderSuggestions is the sql client: not serializable, not interesting.
    suggestionsCalls: mocks.getPurchaseOrderSuggestions.mock.calls.map((call) => ({ options: call[1], scope: call[2] })),
    communicationCalls: mocks.recordPurchaseOrderCommunication.mock.calls.map((call) => call[0]),
  };
}

const request = (body: Record<string, unknown>) => new Request("http://localhost/api/liff/orders", {
  method: "POST",
  body: JSON.stringify({ idToken, ...body }),
});
const callPatch = (id: string, body: Record<string, unknown>) =>
  orderPATCH(new Request(`http://localhost/api/liff/orders/${id}`, { method: "PATCH", body: JSON.stringify({ idToken, ...body }) }), { params: Promise.resolve({ id }) });

const suggestion = {
  item_id: "X", name: "Reagent X", unit: "box", vendor: "Vendor A", policy_order_qty: 4, dynamic_order_qty: 4,
  on_order_qty: 0, committed_no_eta_qty: 0, calculation_version: "v5", policy_configured: true,
};
const orderBody = { vendor: "Vendor A", items: [{ item_id: "X", item_name: "Reagent X", quantity: 4, unit: "box" }], note: "n1", expected_date: "2026-08-20" };
const createdTransaction: Row[][] = [[], [], [{
  purchase_order: { id: 9, po_number: "PO-20260810-001", vendor: "Vendor A", status: "PENDING_MANAGER_REVIEW", expected_date: "2026-08-20" },
  items: [{ item_name: "Reagent X", quantity: 4, unit: "box" }],
}]];
const existingPo = { id: 5, po_number: "PO-20260801-002", vendor: "Vendor A", status: "PENDING_MANAGER_REVIEW" };
const poRow = (status: string) => ({ id: 3, po_number: "PO-20260801-003", vendor: "Vendor A", status, confirmed_at: null });
const reviewTransaction: Row[][] = [[{ ok: true }], [], []];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubEnv("DEPARTMENTS_ENABLED", "");
  vi.stubEnv("LINE_LIFF_CHANNEL_ID", "1234567890");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-10T03:04:05.678Z"));
  mocks.verifyLineIdToken.mockResolvedValue({ sub: "U-line-1" });
  mocks.recordPurchaseOrderCommunication.mockResolvedValue(undefined);
  mocks.getPurchaseOrderSuggestions.mockResolvedValue([suggestion]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await sql.db.close();
});

describe("LIFF ordering routes with departments off (legacy)", () => {
  it("sends exactly the pre-change statements and answers the same status / body", async () => {
    const bootstrapRows = (text: string) => {
      if (/FROM master_data/.test(text)) return [{ vendor: "Vendor A", item_count: 2 }];
      if (/FROM purchase_orders p/.test(text)) return [{ id: 7, po_number: "PO-20260801-007", status: "SUBMITTED" }];
      if (/FROM purchase_order_items/.test(text)) return [{ id: 1, po_id: 7, item_id: "X" }];
      return undefined;
    };
    const dedupeFound = (text: string) => {
      if (/FROM purchase_orders\s+WHERE liff_request_id/.test(text)) return [existingPo];
      if (/FROM purchase_order_items/.test(text)) return [{ id: 1, po_id: 5, item_id: "X" }];
      return undefined;
    };
    const patchFound = (status: string) => (text: string) => {
      if (/FROM purchase_orders WHERE (id|po_number) = /.test(text)) return [poRow(status)];
      if (/FROM purchase_order_items/.test(text)) return [{ id: 1, po_id: 3 }];
      return undefined;
    };

    const results = {
      bootstrap: await capture(() => bootstrapPOST(request({})), { rows: bootstrapRows }),
      catalogSuggestOnly: await capture(() => catalogPOST(request({ vendor: "Vendor A" }))),
      catalogKeyword: await capture(() => catalogPOST(request({ vendor: "Vendor A", keyword: "abc" }))),
      catalogBrowseAll: await capture(() => catalogPOST(request({ vendor: "Vendor A", suggestOnly: false }))),
      catalogNoVendor: await capture(() => catalogPOST(request({}))),
      postDedupeFound: await capture(() => ordersPOST(request({ ...orderBody, liffRequestId: "req-1" })), { rows: dedupeFound }),
      postCreateAfterDedupeMiss: await capture(() => ordersPOST(request({ ...orderBody, liffRequestId: "req-2" })), { transactionResult: createdTransaction }),
      postWithoutLiffRequestId: await capture(() => ordersPOST(request(orderBody)), { transactionResult: createdTransaction }),
      postNoLiffColumn: await capture(() => ordersPOST(request({ ...orderBody, liffRequestId: "req-3" })), { liffRequestColumn: false, transactionResult: createdTransaction }),
      postVendorEmpty: await capture(() => ordersPOST(request({ ...orderBody, vendor: "  " }))),
      patchNumericId: await capture(() => callPatch("3", { action: "APPROVE_REVISION" }), { rows: patchFound("REVISION_REQUESTED"), transactionResult: reviewTransaction }),
      patchPoNumber: await capture(() => callPatch("PO-20260801-003", { action: "REJECT_REVISION" }), { rows: patchFound("REVISION_REQUESTED"), transactionResult: reviewTransaction }),
      patchLegacyStatus: await capture(() => callPatch("3", { status: "CONFIRMED" }), { rows: patchFound("PENDING_LAB_REVIEW"), transactionResult: reviewTransaction }),
      patchNotFound: await capture(() => callPatch("999", { action: "APPROVE_REVISION" })),
      patchNotAwaitingReview: await capture(() => callPatch("3", { action: "APPROVE_REVISION" }), { rows: patchFound("SUBMITTED") }),
      patchActionOnLabReview: await capture(() => callPatch("3", { action: "APPROVE_REVISION" }), { rows: patchFound("PENDING_LAB_REVIEW") }),
      patchBadAction: await capture(() => callPatch("3", { action: "DELETE" })),
      authInvalidToken: await (async () => {
        mocks.verifyLineIdToken.mockResolvedValueOnce(null);
        return capture(() => bootstrapPOST(request({})));
      })(),
      authNoLineColumn: await capture(() => bootstrapPOST(request({})), { lineColumn: false }),
      authNotLinked: await capture(() => bootstrapPOST(request({})), { userRows: [] }),
      authRoleUser: await capture(() => bootstrapPOST(request({})), { userRows: [{ ...manager, role: "User" }] }),
      authRoleVendor: await capture(() => bootstrapPOST(request({})), { userRows: [{ ...manager, role: "Vendor", vendor: "Vendor A" }] }),
      authSuspended: await capture(() => bootstrapPOST(request({})), { userRows: [{ ...manager, account_status: "suspended" }] }),
      authAdmin: await capture(() => bootstrapPOST(request({})), { userRows: [{ ...manager, username: "admin1", role: "Admin" }] }),
    };

    // Sanity: every case reached the intended branch (a wrong status means the capture is meaningless).
    expect(Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.status]))).toEqual({
      bootstrap: 200, catalogSuggestOnly: 200, catalogKeyword: 200, catalogBrowseAll: 200, catalogNoVendor: 400,
      postDedupeFound: 200, postCreateAfterDedupeMiss: 201, postWithoutLiffRequestId: 201, postNoLiffColumn: 201, postVendorEmpty: 400,
      patchNumericId: 200, patchPoNumber: 200, patchLegacyStatus: 200, patchNotFound: 404, patchNotAwaitingReview: 409,
      patchActionOnLabReview: 409, patchBadAction: 400,
      authInvalidToken: 401, authNoLineColumn: 400, authNotLinked: 403, authRoleUser: 403, authRoleVendor: 403, authSuspended: 403, authAdmin: 200,
    });

    const actual = JSON.parse(JSON.stringify(results)) as typeof results;
    if (process.env.UPDATE_LIFF_ORDERS_BASELINE === "1") writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as typeof actual;

    expect(Object.keys(actual)).toEqual(Object.keys(baseline));
    for (const key of Object.keys(baseline) as Array<keyof typeof baseline>) {
      expect(actual[key].statements, `${key} statement count`).toHaveLength(baseline[key].statements.length);
      actual[key].statements.forEach((query, index) => {
        expect(query.text, `${key}[${index}] text`).toBe(baseline[key].statements[index].text);
        expect(query.params, `${key}[${index}] params`).toEqual(baseline[key].statements[index].params);
        expect(query.text).not.toMatch(/department_id/i);
      });
      expect(actual[key].status, `${key} status`).toBe(baseline[key].status);
      expect(actual[key].body, `${key} body`).toEqual(baseline[key].body);
      expect(actual[key].suggestionsCalls, `${key} suggestions args`).toEqual(baseline[key].suggestionsCalls);
      expect(actual[key].communicationCalls, `${key} communication args`).toEqual(baseline[key].communicationCalls);
    }
    expect(actual).toEqual(baseline);

    // Spot checks that the baseline really holds what this test is about (a baseline of empty arrays would prove nothing).
    expect(actual.postCreateAfterDedupeMiss.statements).toHaveLength(8); // 3 auth + liff column + dedupe + 3 transaction
    expect(actual.catalogSuggestOnly.suggestionsCalls[0].scope).toEqual({ mode: "legacy" });
  });
});
