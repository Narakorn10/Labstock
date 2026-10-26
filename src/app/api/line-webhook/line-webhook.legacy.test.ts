import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PgliteSql } from "@/test/pglite-sql";

// With DEPARTMENTS_ENABLED off, POST /api/line-webhook must send EXACTLY the statements it sent before the department change
// (text, params, order, count), answer the same status and body, and hand the same arguments to the LINE reply helpers.
// The baseline JSON was captured from the ORIGINAL route.ts (before any src file was touched).
//
// Every case that returns data is run under three identities: no source.userId, a userId that is not linked to an account,
// and the userId of a Vendor. The helpers of @/lib/line-bot are mocked (their calls are recorded); bot-stock-queries and
// getLineLinkedUser are the real ones, so their SQL is part of the baseline.
//
// LIMIT: this proves identity only through the PGlite shim (createPgliteSql), which composes nested sql fragments itself.
// It was never run against Neon: check the scoped queries on real Neon at rehearsal before enabling the flag.
//
// To regenerate the baseline on purpose (never done silently): UPDATE_LINE_WEBHOOK_BASELINE=1 npx vitest run <this file>.

const SECRET = "test-channel-secret";

// route.ts reads LINE_CHANNEL_SECRET once, at import time, so it has to be set before the route is imported.
const mocks = vi.hoisted(() => {
  process.env.LINE_CHANNEL_SECRET = "test-channel-secret";
  return { replies: [] as Array<{ call: string; args: unknown[] }> };
});

// route.ts and @/lib/db each call neon(): hand both the SAME shim (the factory runs once per test file).
vi.mock("@neondatabase/serverless", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  const shared = createPgliteSql();
  return { neon: () => shared };
});
vi.mock("@/lib/line-bot", () => {
  const record = (call: string) => async (...args: unknown[]) => { mocks.replies.push({ call, args }); };
  return {
    lineClient: { replyMessage: record("lineClient.replyMessage") },
    getLineOrderUrl: () => "https://order.test/liff",
    replyDispenseMenu: record("replyDispenseMenu"),
    replyHelp: record("replyHelp"),
    replyLowStock: record("replyLowStock"),
    replyOrderingMenu: record("replyOrderingMenu"),
    replyPODetail: record("replyPODetail"),
    replyStockSummary: record("replyStockSummary"),
    replyTrackingStatus: record("replyTrackingStatus"),
  };
});

import dbSql from "@/lib/db";
import { POST } from "./route";

const sql = dbSql as unknown as PgliteSql;
const BASELINE_PATH = path.resolve(process.cwd(), "src/app/api/line-webhook/line-webhook.legacy-baseline.json");

type Row = Record<string, unknown>;
type Captured = Array<{ text: string; params: unknown[] }>;
type Source = { userId?: string };
type Identity = { source: Source | undefined; userRows: Row[] };

const vendorRow: Row = { username: "vend1", name: "Vendor One", role: "Vendor", vendor: "Vendor A", account_status: "active" };
const identities: Record<string, Identity> = {
  noUserId: { source: undefined, userRows: [] },
  unlinked: { source: { userId: "U-unlinked" }, userRows: [] },
  vendor: { source: { userId: "U-vendor" }, userRows: [vendorRow] },
};
const vendorWithoutVendor: Identity = { source: { userId: "U-vendor-empty" }, userRows: [{ ...vendorRow, vendor: null }] };

const stockRow = { itemId: "X1", name: "Reagent X", jobType: "Hematology", machineType: "M1", unit: "box", minThreshold: 5, quantity: "3" };
const poRow = { id: 7, po_number: "PO-20260801-001", vendor: "Vendor A", status: "SUBMITTED", expected_date: "2026-08-20" };
const poItems = [{ item_name: "Reagent X", quantity: "4", unit: "box" }, { item_name: "Reagent Y", quantity: "2", unit: "pack" }];
const shipmentRow = { id: 1, tracking_no: "AB123456789TH", tracking_provider: "Thailand Post", tracking_status: "IN_TRANSIT" };

type Answers = { stock?: Row[]; lowStock?: Row[]; po?: Row[]; poItems?: Row[]; shipments?: Row[] };

function answer(text: string, identity: Identity, answers: Answers): Row[] {
  if (/column_name = 'account_status'/.test(text)) return [{ exists: true }];
  if (/FROM users\s+WHERE line_user_id/.test(text)) return identity.userRows;
  if (/COALESCE\(i\.current_qty, 0\) <= m\.min_threshold/.test(text)) return answers.lowStock ?? [];
  if (/WITH InventorySummary/.test(text)) return answers.stock ?? [];
  if (/FROM purchase_orders WHERE po_number/.test(text)) return answers.po ?? [];
  if (/FROM purchase_order_items/.test(text)) return answers.poItems ?? [];
  if (/FROM shipments WHERE tracking_no/.test(text)) return answers.shipments ?? [];
  return [];
}

function signedRequest(events: object[]): Request {
  const body = JSON.stringify({ events });
  const signature = createHmac("sha256", SECRET).update(body).digest("base64");
  return new Request("http://localhost/api/line-webhook", {
    method: "POST",
    headers: { "x-line-signature": signature },
    body,
  });
}

// Records every statement the route sends (the query is seen when PGlite is asked to execute it; nothing is really executed).
async function capture(run: (post: typeof POST) => Promise<Response>, identity: Identity, answers: Answers = {}, post: typeof POST = POST, client: PgliteSql = sql) {
  const statements: Captured = [];
  vi.spyOn(client.db, "query").mockImplementation((async (text: string, params: unknown[]) => {
    statements.push({ text, params });
    return { rows: answer(text, identity, answers) };
  }) as never);
  mocks.replies.length = 0;
  const response = await run(post);
  vi.mocked(client.db.query).mockRestore();
  return {
    status: response.status,
    body: JSON.parse(await response.text()) as unknown,
    statements,
    replies: mocks.replies.map((reply) => ({ call: reply.call, args: reply.args })),
  };
}

const textEvent = (text: string, source: Source | undefined, extra: Row = {}) => ({
  type: "message", replyToken: "rt-1", source, message: { type: "text", id: "m1", text }, ...extra,
});
const postbackEvent = (data: string, source: Source | undefined, extra: Row = {}) => ({
  type: "postback", replyToken: "rt-1", source, postback: { data }, ...extra,
});

// Cases that are run once per identity. The event is built from the identity's source.
const textCases: Record<string, { text: string; answers?: Answers }> = {
  stockKeyword: { text: "stock abc", answers: { stock: [stockRow] } },
  stockJob: { text: "stock งาน hematology", answers: { stock: [stockRow] } },
  stockRemaining: { text: "สต็อกเหลือ abc", answers: { stock: [stockRow] } },
  stockRemainingQuestion: { text: "abc เหลือเท่าไหร่", answers: { stock: [stockRow] } },
  stockBareWithLow: { text: "stock", answers: { lowStock: [stockRow] } },
  stockBareNoLow: { text: "stock" },
  stockThaiTone: { text: "สต๊อก", answers: { lowStock: [stockRow] } },
  poFoundWithItems: { text: "PO-20260801-001", answers: { po: [poRow], poItems } },
  poFoundNoItems: { text: "PO-20260801-001", answers: { po: [poRow] } },
  poNotFound: { text: "PO-99999999-999" },
  poLowercase: { text: "po-20260801-001", answers: { po: [poRow], poItems } },
  poLowercaseNotFound: { text: "po-xxx" },
  trackingFound: { text: "AB123456789TH", answers: { shipments: [shipmentRow] } },
  trackingNotFound: { text: "AB123456789TH" },
  help: { text: "help" },
  menu: { text: "เมนู" },
  order: { text: "order" },
  dispense: { text: "เบิก" },
  id: { text: "id" },
  register: { text: "ลงทะเบียน" },
  purchaseOrderLink: { text: "สั่งซื้อ" },
  unmatched: { text: "สวัสดีครับ" },
  vendorReject: { text: "ปฏิเสธ PO-1: เหตุผล" },
};

const postbackCases: Record<string, string> = {
  ackExpiry: "action=ack_expiry&itemId=X1&lotNo=L1&expDate=2026-09-01",
  ackExpiryMissingParam: "action=ack_expiry&itemId=X1&expDate=2026-09-01",
  acknowledgePo: "action=acknowledge_po&id=PO-1",
  acknowledgePoNoId: "action=acknowledge_po",
  confirmVendorPo: "action=confirm_vendor_po&id=PO-1",
  startVendorReject: "action=start_vendor_reject&id=PO-1",
  confirmPo: "action=confirm_po&id=PO-1",
  rejectPo: "action=reject_po&id=PO-1",
  rejectPoNoId: "action=reject_po",
  unknownAction: "action=something_else&id=PO-1",
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("DEPARTMENTS_ENABLED", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-10T03:04:05.678Z"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await sql.db.close();
});

describe("line-webhook with departments off (legacy)", () => {
  it("sends exactly the pre-change statements and answers the same status / body / replies", async () => {
    const results: Record<string, Awaited<ReturnType<typeof capture>>> = {};

    for (const [identityName, identity] of Object.entries(identities)) {
      for (const [caseName, testCase] of Object.entries(textCases)) {
        results[`${caseName}:${identityName}`] = await capture(
          () => POST(signedRequest([textEvent(testCase.text, identity.source)])), identity, testCase.answers);
      }
      for (const [caseName, data] of Object.entries(postbackCases)) {
        results[`${caseName}:${identityName}`] = await capture(
          () => POST(signedRequest([postbackEvent(data, identity.source)])), identity);
      }
      results[`nonTextMessage:${identityName}`] = await capture(
        () => POST(signedRequest([{ type: "message", replyToken: "rt-1", source: identity.source, message: { type: "image", id: "m2" } }])), identity);
      results[`followEvent:${identityName}`] = await capture(
        () => POST(signedRequest([{ type: "follow", replyToken: "rt-1", source: identity.source }])), identity);
      results[`textNoReplyToken:${identityName}`] = await capture(
        () => POST(signedRequest([textEvent("stock abc", identity.source, { replyToken: undefined })])), identity, { stock: [stockRow] });
      results[`postbackNoReplyToken:${identityName}`] = await capture(
        () => POST(signedRequest([postbackEvent(postbackCases.ackExpiry, identity.source, { replyToken: undefined })])), identity);
      results[`batch:${identityName}`] = await capture(() => POST(signedRequest([
        textEvent("help", identity.source),
        textEvent("stock abc", identity.source),
        textEvent("id", identity.source),
        postbackEvent(postbackCases.ackExpiry, identity.source),
        postbackEvent(postbackCases.confirmPo, identity.source),
      ])), identity, { stock: [stockRow] });
      results[`emptyBatch:${identityName}`] = await capture(() => POST(signedRequest([])), identity);
    }

    // A Vendor account with no vendor name attached.
    results.vendorRejectVendorWithoutVendor = await capture(
      () => POST(signedRequest([textEvent("ปฏิเสธ PO-1: เหตุผล", vendorWithoutVendor.source)])), vendorWithoutVendor);
    results.startVendorRejectVendorWithoutVendor = await capture(
      () => POST(signedRequest([postbackEvent(postbackCases.startVendorReject, vendorWithoutVendor.source)])), vendorWithoutVendor);
    results.rejectPoVendorWithoutVendor = await capture(
      () => POST(signedRequest([postbackEvent(postbackCases.rejectPo, vendorWithoutVendor.source)])), vendorWithoutVendor);

    // Signature failures are decided before anything else runs.
    const bodyText = JSON.stringify({ events: [textEvent("stock abc", identities.vendor.source)] });
    results.signatureWrong = await capture(() => POST(new Request("http://localhost/api/line-webhook", {
      method: "POST", headers: { "x-line-signature": "not-a-valid-signature" }, body: bodyText,
    })), identities.vendor);
    results.signatureMissing = await capture(() => POST(new Request("http://localhost/api/line-webhook", {
      method: "POST", body: bodyText,
    })), identities.vendor);

    // Sanity: every case reached the intended branch (a wrong status means the capture is meaningless).
    const statuses = Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.status]));
    expect(Object.entries(statuses).filter(([key]) => !key.startsWith("signature")).every(([, status]) => status === 200)).toBe(true);
    expect(statuses.signatureWrong).toBe(401);
    expect(statuses.signatureMissing).toBe(401);

    const actual = JSON.parse(JSON.stringify(results)) as typeof results;
    if (process.env.UPDATE_LINE_WEBHOOK_BASELINE === "1") writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as typeof actual;

    expect(Object.keys(actual)).toEqual(Object.keys(baseline));
    for (const key of Object.keys(baseline)) {
      expect(actual[key].statements, `${key} statement count`).toHaveLength(baseline[key].statements.length);
      actual[key].statements.forEach((query, index) => {
        expect(query.text, `${key}[${index}] text`).toBe(baseline[key].statements[index].text);
        expect(query.params, `${key}[${index}] params`).toEqual(baseline[key].statements[index].params);
        expect(query.text).not.toMatch(/department_id/i);
      });
      expect(actual[key].status, `${key} status`).toBe(baseline[key].status);
      expect(actual[key].body, `${key} body`).toEqual(baseline[key].body);
      expect(actual[key].replies, `${key} replies`).toEqual(baseline[key].replies);
    }
    expect(actual).toEqual(baseline);

    // Spot checks that the baseline really holds what this test is about (a baseline of empty results would prove nothing).
    expect(actual["stockKeyword:vendor"].statements).toHaveLength(1);
    expect(actual["stockKeyword:vendor"].replies[0].call).toBe("replyStockSummary");
    expect(actual["unknownAction:vendor"].statements.at(-1)?.text).toMatch(/SELECT username, role FROM users/);
    expect(actual["trackingFound:vendor"].replies[0].args).toEqual(["rt-1", expect.objectContaining({ lastUpdate: "2026-08-10T03:04:05.678Z" })]);
    expect(actual["signatureWrong"].statements).toHaveLength(0);
  });
});

describe("line-webhook without a usable channel secret", () => {
  // route.ts reads the secret into a constant at import time, so each case needs a fresh import of the route.
  const unconfigured: Array<[string, string | undefined]> = [["no secret", undefined], ["DUMMY_SECRET", "DUMMY_SECRET"]];

  it("answers 503 before looking at the signature or touching the database", async () => {
    const results: Record<string, Awaited<ReturnType<typeof capture>>> = {};

    for (const [name, secret] of unconfigured) {
      vi.resetModules();
      vi.stubEnv("LINE_CHANNEL_SECRET", secret);
      const fresh = await import("./route");
      const freshSql = (await import("@/lib/db")).default as unknown as PgliteSql;
      results[name] = await capture(
        (post) => post(signedRequest([textEvent("stock abc", identities.vendor.source)])), identities.vendor, {}, fresh.POST, freshSql);
      results[`${name} (wrong signature)`] = await capture(
        (post) => post(new Request("http://localhost/api/line-webhook", {
          method: "POST", headers: { "x-line-signature": "nope" }, body: JSON.stringify({ events: [] }),
        })), identities.vendor, {}, fresh.POST, freshSql);
    }

    const actual = JSON.parse(JSON.stringify(results)) as typeof results;
    for (const value of Object.values(actual)) {
      expect(value.status).toBe(503);
      expect(value.body).toEqual({ error: "Webhook is not configured" });
      expect(value.statements).toEqual([]);
      expect(value.replies).toEqual([]);
    }
  });
});
