import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { PgliteSql } from "@/test/pglite-sql";

// Department behaviour of POST /api/line-webhook with DEPARTMENTS_ENABLED=true, on the production schema + v30-v35 (PGlite).
// Real: the route, the gate (getLineBotAccess), department-context, scoped-db, bot-stock-queries, line-bot-queries.
// Mocked: @/lib/line-bot (its helpers record their calls) and the neon client (one PGlite shim shared by route.ts and @/lib/db).
//
// Every refusal case also asserts that NO data statement (purchase_orders / shipments / inventory / master_data) was issued.
//
// LIMIT: PGlite only, never Neon: check the scoped queries on real Neon at rehearsal before enabling the flag.

const SECRET = "test-channel-secret";

const mocks = vi.hoisted(() => {
  process.env.LINE_CHANNEL_SECRET = "test-channel-secret";
  return { replies: [] as Array<{ call: string; args: unknown[] }> };
});

// route.ts and @/lib/db each call neon(): hand both the SAME shim. DATE comes back as text like on Neon (expected_date goes into replyPODetail).
vi.mock("@neondatabase/serverless", async () => {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const { createPgliteSql } = await import("@/test/pglite-sql");
  const shared = createPgliteSql(new PGlite({ parsers: { [types.DATE]: (value: string) => value } }));
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
import { resetDepartmentContextForTests } from "@/lib/department-context";
import { markDepartmentsNotReady, resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { LINE_BOT_MESSAGES } from "@/lib/line-bot-queries";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder } from "@/test/purchase-order-dept-fixtures";
import { POST } from "./route";

const sql = dbSql as unknown as PgliteSql;
const DEPT_CLOSED = 3;

// Every user has users.line_user_id = "U-<username>". The membership is listed in the comment.
//   mgra A, mgrb B, user-a A (User), mgr-user-override / mgr-operator-override / mgr-technician-override: global Manager, B default
//   with a per-department role of User / Operator / Technician, mgrnone: no membership, mgr-inactive-dept: default department closed,
//   admin-nomember: global Admin without membership (lowest active department = A), vendor-v1 (A), vendor-v2 (B), vendor-blank (A, vendor ''),
//   vendor-nomember (Vendor V1 without any user_departments row), inactive-account: suspended Manager of A.
beforeAll(async () => {
  vi.stubEnv("DEPARTMENTS_ENABLED", "true");
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
  await sql.db.exec(`
    INSERT INTO departments (id, name, code, is_active) VALUES (${DEPT_CLOSED}, 'Closed dept', 'XX', false);
    INSERT INTO users (username, password_hash, name, role, vendor, account_status) VALUES
      ('mgra', 'x', 'Manager A', 'Manager', '', 'active'),
      ('mgrb', 'x', 'Manager B', 'Manager', '', 'active'),
      ('user-a', 'x', 'User A', 'User', '', 'active'),
      ('mgr-user-override', 'x', 'Manager User Override', 'Manager', '', 'active'),
      ('mgr-operator-override', 'x', 'Manager Operator Override', 'Manager', '', 'active'),
      ('mgr-technician-override', 'x', 'Manager Technician Override', 'Manager', '', 'active'),
      ('mgrnone', 'x', 'Manager No Membership', 'Manager', '', 'active'),
      ('mgr-inactive-dept', 'x', 'Manager Closed Dept', 'Manager', '', 'active'),
      ('admin-nomember', 'x', 'Admin No Membership', 'Admin', '', 'active'),
      ('vendor-v1', 'x', 'Vendor One', 'Vendor', 'V1', 'active'),
      ('vendor-v2', 'x', 'Vendor Two', 'Vendor', 'V2', 'active'),
      ('vendor-blank', 'x', 'Vendor Blank', 'Vendor', '', 'active'),
      ('vendor-nomember', 'x', 'Vendor No Membership', 'Vendor', 'V1', 'active'),
      ('inactive-account', 'x', 'Inactive Account', 'Manager', '', 'suspended');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('mgra', ${DEPT_A}, NULL, true),
      ('mgrb', ${DEPT_B}, NULL, true),
      ('user-a', ${DEPT_A}, NULL, true),
      ('mgr-user-override', ${DEPT_B}, 'User', true),
      ('mgr-operator-override', ${DEPT_B}, 'Operator', true),
      ('mgr-technician-override', ${DEPT_B}, 'Technician', true),
      ('mgr-inactive-dept', ${DEPT_CLOSED}, NULL, true),
      ('vendor-v1', ${DEPT_A}, NULL, true),
      ('vendor-v2', ${DEPT_B}, NULL, true),
      ('vendor-blank', ${DEPT_A}, NULL, true),
      ('inactive-account', ${DEPT_A}, NULL, true);
    UPDATE users SET line_user_id = 'U-' || username
      WHERE username IN ('mgra', 'mgrb', 'user-a', 'mgr-user-override', 'mgr-operator-override', 'mgr-technician-override', 'mgrnone',
        'mgr-inactive-dept', 'admin-nomember', 'vendor-v1', 'vendor-v2', 'vendor-blank', 'vendor-nomember', 'inactive-account');

    UPDATE master_data SET min_threshold = -1;
    UPDATE master_data SET min_threshold = 100 WHERE item_id IN ('LAB-000001', 'MB-000001');
    INSERT INTO inventory (item_id, lot_no, quantity, department_id) VALUES ('MB-000001', 'LB1', 4, ${DEPT_B});
  `);
  await insertPurchaseOrder(sql, { poNumber: "PO-A-V1", departmentId: DEPT_A, status: "SENT", vendor: "V1" });
  await insertPurchaseOrder(sql, { poNumber: "PO-B-V1", departmentId: DEPT_B, status: "SENT", vendor: "V1", itemId: "MB-000001" });
  await insertPurchaseOrder(sql, { poNumber: "PO-B-V2", departmentId: DEPT_B, status: "SENT", vendor: "V2", itemId: "MB-000001" });
  await insertPurchaseOrder(sql, { poNumber: "PO-A-V1-REVIEW", departmentId: DEPT_A, status: "PENDING_MANAGER_REVIEW", vendor: "V1" });
  await insertPurchaseOrder(sql, { poNumber: "PO-A-BLANK", departmentId: DEPT_A, status: "SENT", vendor: "" });
  await sql.db.exec(`UPDATE purchase_orders SET expected_date = '2026-08-20' WHERE po_number = 'PO-A-V1'`);
  const ship = (trackingNo: string, vendor: string, departmentId: number, itemId: string) =>
    sql.db.query(
      "INSERT INTO shipments (vendor, item_id, lot_no, quantity, tracking_no, tracking_provider, tracking_status, department_id) VALUES ($1, $2, 'L1', 1, $3, 'Thailand Post', 'IN_TRANSIT', $4)",
      [vendor, itemId, trackingNo, departmentId],
    );
  await ship("AA111111111TH", "V1", DEPT_A, "LAB-000001");
  await ship("BB222222222TH", "V1", DEPT_B, "MB-000001");
  await ship("CC333333333TH", "V2", DEPT_B, "MB-000001");
  await ship("DD444444444TH", "", DEPT_A, "LAB-000001");
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await sql.db.close();
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("DEPARTMENTS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  resetDepartmentsFlagForTests();
  resetDepartmentContextForTests();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

type Reply = { call: string; args: unknown[] };
type Intercept = (text: string) => void;

const DATA_STATEMENT = /\b(?:FROM|JOIN)\s+(?:purchase_orders|purchase_order_items|shipments|inventory|master_data)\b/i;

function signedRequest(events: object[]): Request {
  const body = JSON.stringify({ events });
  const signature = createHmac("sha256", SECRET).update(body).digest("base64");
  return new Request("http://localhost/api/line-webhook", { method: "POST", headers: { "x-line-signature": signature }, body });
}

const textEvent = (text: string, userId: string | null) => ({
  type: "message", replyToken: "rt-1", source: userId ? { userId } : undefined, message: { type: "text", id: "m1", text },
});
const postbackEvent = (data: string, userId: string | null) => ({
  type: "postback", replyToken: "rt-1", source: userId ? { userId } : undefined, postback: { data },
});

// Sends the events and records every statement (passed through to PGlite; `intercept` may throw to simulate a database error).
async function post(events: object[], intercept?: Intercept) {
  const original = sql.db.query.bind(sql.db) as (text: string, params?: unknown[]) => Promise<unknown>;
  const statements: string[] = [];
  const spy = vi.spyOn(sql.db, "query").mockImplementation((async (text: string, params?: unknown[]) => {
    statements.push(text);
    intercept?.(text);
    return original(text, params);
  }) as never);
  mocks.replies.length = 0;
  const response = await POST(signedRequest(events));
  spy.mockRestore();
  const replies: Reply[] = mocks.replies.map((reply) => ({ call: reply.call, args: reply.args }));
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
    statements,
    dataStatements: statements.filter((text) => DATA_STATEMENT.test(text)),
    replies,
    texts: replies
      .filter((reply) => reply.call === "lineClient.replyMessage")
      .map((reply) => (reply.args[0] as { messages: Array<{ text: string }> }).messages[0].text),
    calls: replies.map((reply) => reply.call),
  };
}

const say = (text: string, username: string | null, intercept?: Intercept) => post([textEvent(text, username ? `U-${username}` : null)], intercept);

const notFoundPO = (po: string) => `ไม่พบใบสั่งซื้อหมายเลข ${po} ในระบบค่ะ`;
const notFoundShipment = (no: string) => `ไม่พบข้อมูลพัสดุ ${no} ในระบบค่ะ`;

type Result = Awaited<ReturnType<typeof post>>;
const stockOf = (result: Result) => {
  const reply = result.replies.find((r) => r.call === "replyStockSummary" || r.call === "replyLowStock");
  const rows = (reply?.call === "replyStockSummary" ? reply.args[2] : reply?.args[1]) as Array<{ itemId: string }> | undefined;
  return rows?.map((row) => row.itemId).sort();
};
const poOf = (result: Result) => {
  const reply = result.replies.find((r) => r.call === "replyPODetail");
  return reply ? reply.args[1] as { po_number: string; vendor: string; expected_date: string | null; items: unknown[] } : null;
};
const trackingOf = (result: Result) => {
  const reply = result.replies.find((r) => r.call === "replyTrackingStatus");
  return reply ? reply.args[1] as { trackingNo: string; provider: string; status: string } : null;
};

describe("fixture controls (the data the assertions below rely on really exists)", () => {
  it("both departments have POs, shipments and stock; the users are linked", async () => {
    const rows = async (query: string) => (await sql.db.query<{ v: string }>(query)).rows.map((row) => row.v);
    expect(await rows(`SELECT po_number || '|' || vendor || '|' || department_id AS v FROM purchase_orders WHERE po_number LIKE 'PO-A-%' OR po_number LIKE 'PO-B-%' ORDER BY po_number`)).toEqual([
      `PO-A-BLANK||${DEPT_A}`, `PO-A-V1|V1|${DEPT_A}`, `PO-A-V1-REVIEW|V1|${DEPT_A}`, `PO-B-V1|V1|${DEPT_B}`, `PO-B-V2|V2|${DEPT_B}`,
    ]);
    expect(await rows(`SELECT tracking_no || '|' || vendor || '|' || department_id AS v FROM shipments WHERE tracking_no IN ('AA111111111TH', 'BB222222222TH', 'CC333333333TH', 'DD444444444TH') ORDER BY tracking_no`)).toEqual([
      `AA111111111TH|V1|${DEPT_A}`, `BB222222222TH|V1|${DEPT_B}`, `CC333333333TH|V2|${DEPT_B}`, `DD444444444TH||${DEPT_A}`,
    ]);
    expect(await rows(`SELECT item_id || '|' || department_id AS v FROM inventory ORDER BY item_id`)).toContain(`MB-000001|${DEPT_B}`);
    expect((await rows(`SELECT username AS v FROM users WHERE line_user_id IS NOT NULL ORDER BY username`)).length).toBe(14);
  });
});

describe("no identity (flag on): unlinked, inactive account, no source.userId", () => {
  const commands = [["PO-A-V1", "PO"], ["AA111111111TH", "tracking number"], ["stock", "bare stock"], ["stock reagent", "stock keyword"], ["stock งาน routine", "stock by job"]];
  const identities: Array<[string, string | null]> = [["unlinked LINE id", "unlinked-id"], ["inactive account", "inactive-account"], ["no source.userId", null]];

  for (const [identityName, username] of identities) {
    it.each(commands)(`${identityName}: "%s" (%s) answers the unlinked message and reads no data`, async (text) => {
      const result = await say(text, username);
      expect(result.status).toBe(200);
      expect(result.texts).toEqual([LINE_BOT_MESSAGES.unlinked]);
      expect(result.calls).toEqual(["lineClient.replyMessage"]);
      expect(result.dataStatements).toEqual([]);
    });
  }
});

describe("lab Manager / Admin scope", () => {
  it("mgra sees the PO, shipment and stock of department A (positive control)", async () => {
    const po = await say("PO-A-V1", "mgra");
    expect(poOf(po)).toMatchObject({ po_number: "PO-A-V1", vendor: "V1", expected_date: "2026-08-20" });
    expect(poOf(po)?.items).toHaveLength(1);
    expect(trackingOf(await say("AA111111111TH", "mgra"))).toMatchObject({ trackingNo: "AA111111111TH", provider: "Thailand Post", status: "IN_TRANSIT" });
    expect(stockOf(await say("stock reagent 1", "mgra"))).toEqual(["LAB-000001"]);
    expect(stockOf(await say("stock", "mgra"))).toEqual(["LAB-000001"]);
  });

  it("mgra does not see the PO, shipment or stock of department B", async () => {
    const po = await say("PO-B-V1", "mgra");
    expect(po.texts).toEqual([notFoundPO("PO-B-V1")]);
    expect(po.calls).toEqual(["lineClient.replyMessage"]);
    const tracking = await say("BB222222222TH", "mgra");
    expect(tracking.texts).toEqual([notFoundShipment("BB222222222TH")]);
    expect(stockOf(await say("stock dept b item", "mgra"))).toEqual([]);
    expect(stockOf(await say("stock MB-000001", "mgra"))).toEqual([]);
  });

  it("mgrb sees department B and not department A", async () => {
    expect(poOf(await say("PO-B-V1", "mgrb"))).toMatchObject({ po_number: "PO-B-V1" });
    expect(trackingOf(await say("BB222222222TH", "mgrb"))).toMatchObject({ trackingNo: "BB222222222TH" });
    expect(stockOf(await say("stock dept b item", "mgrb"))).toEqual(["MB-000001", "MB-000002"]);
    expect(stockOf(await say("stock", "mgrb"))).toEqual(["MB-000001"]);

    expect((await say("PO-A-V1", "mgrb")).texts).toEqual([notFoundPO("PO-A-V1")]);
    expect((await say("AA111111111TH", "mgrb")).texts).toEqual([notFoundShipment("AA111111111TH")]);
    expect(stockOf(await say("stock reagent 1", "mgrb"))).toEqual([]);
    expect(stockOf(await say("stock งาน routine", "mgrb"))).toEqual([]);
  });

  it("stock by job is scoped too", async () => {
    expect(stockOf(await say("stock งาน routine", "mgra"))).toEqual(["LAB-000001"]);
  });

  it("an Admin without membership works in the lowest-id active department (A) for stock and PO, never in B", async () => {
    expect(stockOf(await say("stock reagent 1", "admin-nomember"))).toEqual(["LAB-000001"]);
    expect(stockOf(await say("stock dept b item", "admin-nomember"))).toEqual([]);
    expect(poOf(await say("PO-A-V1", "admin-nomember"))).toMatchObject({ po_number: "PO-A-V1" });
    expect((await say("PO-B-V1", "admin-nomember")).texts).toEqual([notFoundPO("PO-B-V1")]);
    expect(trackingOf(await say("AA111111111TH", "admin-nomember"))).toMatchObject({ trackingNo: "AA111111111TH" });
    expect((await say("BB222222222TH", "admin-nomember")).texts).toEqual([notFoundShipment("BB222222222TH")]);
  });

  it("a lab Manager also sees a PO under manager review of their own department", async () => {
    expect(poOf(await say("PO-A-V1-REVIEW", "mgra"))).toMatchObject({ po_number: "PO-A-V1-REVIEW" });
  });
});

describe("no usable department", () => {
  for (const username of ["mgrnone", "mgr-inactive-dept"]) {
    it.each(["PO-A-V1", "AA111111111TH", "stock", "stock reagent"])(`${username}: "%s" answers noWork and reads no data`, async (text) => {
      const result = await say(text, username);
      expect(result.texts).toEqual([LINE_BOT_MESSAGES.noWork]);
      expect(result.calls).toEqual(["lineClient.replyMessage"]);
      expect(result.dataStatements).toEqual([]);
    });
  }
});

describe("lab roles that may not use purchasing", () => {
  // user-a: global User; the others are global Managers whose per-department role in their default department is lower.
  for (const username of ["user-a", "mgr-user-override", "mgr-operator-override", "mgr-technician-override"]) {
    it.each(["PO-A-V1", "PO-B-V1", "AA111111111TH", "BB222222222TH"])(`${username}: "%s" is purchasingDenied and reads no data`, async (text) => {
      const result = await say(text, username);
      expect(result.texts).toEqual([LINE_BOT_MESSAGES.purchasingDenied]);
      expect(result.calls).toEqual(["lineClient.replyMessage"]);
      expect(result.dataStatements).toEqual([]);
    });
  }

  it("they can still search stock, inside their own department", async () => {
    expect(stockOf(await say("stock reagent 1", "user-a"))).toEqual(["LAB-000001"]);
    expect(stockOf(await say("stock dept b item", "user-a"))).toEqual([]);
    for (const username of ["mgr-user-override", "mgr-operator-override", "mgr-technician-override"]) {
      expect(stockOf(await say("stock dept b item", username)), username).toEqual(["MB-000001", "MB-000002"]);
      expect(stockOf(await say("stock reagent 1", username)), username).toEqual([]);
      expect(stockOf(await say("stock", username)), username).toEqual(["MB-000001"]);
    }
  });
});

describe("Vendor", () => {
  it("vendor-v1 sees its POs and shipments in both departments (positive control)", async () => {
    expect(poOf(await say("PO-A-V1", "vendor-v1"))).toMatchObject({ po_number: "PO-A-V1", vendor: "V1" });
    expect(poOf(await say("PO-B-V1", "vendor-v1"))).toMatchObject({ po_number: "PO-B-V1", vendor: "V1" });
    expect(trackingOf(await say("AA111111111TH", "vendor-v1"))).toMatchObject({ trackingNo: "AA111111111TH" });
    expect(trackingOf(await say("BB222222222TH", "vendor-v1"))).toMatchObject({ trackingNo: "BB222222222TH" });
  });

  it("vendor-v1 does not see the PO or shipment of V2; vendor-v2 does (control)", async () => {
    expect((await say("PO-B-V2", "vendor-v1")).texts).toEqual([notFoundPO("PO-B-V2")]);
    expect((await say("CC333333333TH", "vendor-v1")).texts).toEqual([notFoundShipment("CC333333333TH")]);
    expect(poOf(await say("PO-B-V2", "vendor-v2"))).toMatchObject({ po_number: "PO-B-V2" });
    expect(trackingOf(await say("CC333333333TH", "vendor-v2"))).toMatchObject({ trackingNo: "CC333333333TH" });
    expect((await say("PO-A-V1", "vendor-v2")).texts).toEqual([notFoundPO("PO-A-V1")]);
  });

  it("a PO still PENDING_MANAGER_REVIEW is not found by its own vendor", async () => {
    const result = await say("PO-A-V1-REVIEW", "vendor-v1");
    expect(result.texts).toEqual([notFoundPO("PO-A-V1-REVIEW")]);
    expect(result.calls).toEqual(["lineClient.replyMessage"]);
  });

  it("stock is vendorStockDenied and reads no data", async () => {
    for (const text of ["stock", "stock reagent", "stock งาน routine"]) {
      const result = await say(text, "vendor-v1");
      expect(result.texts, text).toEqual([LINE_BOT_MESSAGES.vendorStockDenied]);
      expect(result.dataStatements, text).toEqual([]);
    }
  });

  it("a blank vendor finds nothing, not even the rows whose vendor is ''; no data statement is sent", async () => {
    const po = await say("PO-A-BLANK", "vendor-blank");
    expect(po.texts).toEqual([notFoundPO("PO-A-BLANK")]);
    expect(po.dataStatements).toEqual([]);
    const tracking = await say("DD444444444TH", "vendor-blank");
    expect(tracking.texts).toEqual([notFoundShipment("DD444444444TH")]);
    expect(tracking.dataStatements).toEqual([]);
    // control: the decoy rows exist and a lab Manager of that department finds them
    expect(poOf(await say("PO-A-BLANK", "mgra"))).toMatchObject({ po_number: "PO-A-BLANK" });
    expect(trackingOf(await say("DD444444444TH", "mgra"))).toMatchObject({ trackingNo: "DD444444444TH" });
  });

  it("a Vendor without any user_departments row still sees its own company's PO and shipment (spec 5.5 item 2)", async () => {
    expect(poOf(await say("PO-A-V1", "vendor-nomember"))).toMatchObject({ po_number: "PO-A-V1" });
    expect(poOf(await say("PO-B-V1", "vendor-nomember"))).toMatchObject({ po_number: "PO-B-V1" });
    expect(trackingOf(await say("BB222222222TH", "vendor-nomember"))).toMatchObject({ trackingNo: "BB222222222TH" });
    expect((await say("PO-B-V2", "vendor-nomember")).texts).toEqual([notFoundPO("PO-B-V2")]);
  });
});

describe("commands that are NOT gated", () => {
  const ungated: Array<[string, string]> = [
    ["id", "lineClient.replyMessage"], ["ลงทะเบียน", "lineClient.replyMessage"], ["help", "replyHelp"], ["เมนู", "replyHelp"],
    ["order", "replyOrderingMenu"], ["เบิก", "replyDispenseMenu"], ["สั่งซื้อ", "lineClient.replyMessage"], ["สวัสดีครับ", "replyHelp"],
  ];

  for (const [name, username] of [["unlinked LINE id", "unlinked-id"], ["inactive account", "inactive-account"], ["mgrnone", "mgrnone"], ["vendor-v1", "vendor-v1"]] as const) {
    it.each(ungated)(`${name}: "%s" answers as before and issues no statement`, async (text, call) => {
      const result = await say(text, username);
      expect(result.status).toBe(200);
      expect(result.calls).toEqual([call]);
      expect(result.statements).toEqual([]);
      if (text === "id" || text === "ลงทะเบียน") expect(result.texts[0]).toContain(`U-${username}`);
      if (text === "สั่งซื้อ") expect(result.texts).toEqual(["กรุณาเข้าสู่ระบบเพื่อสร้างใบสั่งซื้อ: https://app.test/orders"]);
      expect(result.texts).not.toContain(LINE_BOT_MESSAGES.unlinked);
    });
  }

  it("the vendor reject text still checks only the account link (no department gate)", async () => {
    const unlinked = await say("ปฏิเสธ PO-1: เหตุผล", "unlinked-id");
    expect(unlinked.texts).toEqual(["บัญชี LINE นี้ยังไม่ได้ผูกกับบัญชี Vendor ที่ใช้งานอยู่ค่ะ"]);
    expect(unlinked.statements.some((text) => /LATERAL|user_departments/.test(text))).toBe(false);
    const vendor = await say("ปฏิเสธ PO-1: เหตุผล", "vendor-v1");
    expect(vendor.texts[0]).toContain("รับเหตุผลการปฏิเสธของ PO PO-1 แล้ว");
  });

  it("postbacks answer and write exactly as before even for an unlinked user (no department gate)", async () => {
    const ack = await post([postbackEvent("action=ack_expiry&itemId=X1&lotNo=L1&expDate=2026-09-01", "U-unlinked-id")]);
    expect(ack.status).toBe(200);
    expect(ack.texts).toEqual(["รับทราบน้ำยา Lot L1 เรียบร้อยแล้ว"]);
    expect(ack.statements.some((text) => /UPDATE expiry_notification_logs/.test(text))).toBe(true);
    expect(ack.statements.some((text) => /LATERAL|user_departments/.test(text))).toBe(false);

    const confirm = await post([postbackEvent("action=confirm_po&id=PO-1", "U-unlinked-id")]);
    expect(confirm.texts).toEqual(["กรุณาเปิดเว็บเพื่อดำเนินการกับ PO PO-1: https://order.test/liff"]);
    expect(confirm.statements.some((text) => /LATERAL|user_departments/.test(text))).toBe(false);

    const noUser = await post([postbackEvent("action=reject_po&id=PO-1", null)]);
    expect(noUser.texts).toEqual(["กรุณาเปิดเว็บเพื่อดำเนินการกับ PO PO-1: https://order.test/liff"]);
  });
});

describe("gate failures", () => {
  it("a generic database error in the department lookup answers 500, replies nothing and never reaches the data queries", async () => {
    const failing: Intercept = (text) => {
      if (/LATERAL/.test(text)) throw Object.assign(new Error("statement timeout"), { code: "57014" });
    };
    for (const text of ["PO-A-V1", "AA111111111TH", "stock reagent"]) {
      const result = await say(text, "mgra", failing);
      expect(result.status, text).toBe(500);
      expect(result.body, text).toEqual({ error: "statement timeout" });
      expect(result.replies, text).toEqual([]);
      expect(result.dataStatements, text).toEqual([]);
      resetDepartmentsFlagForTests();
    }
  });

  it("the error of one event is not swallowed in a batch (the whole request answers 500)", async () => {
    const failing: Intercept = (text) => {
      if (/LATERAL/.test(text)) throw Object.assign(new Error("statement timeout"), { code: "57014" });
    };
    const result = await post([textEvent("help", "U-mgra"), textEvent("PO-A-V1", "U-mgra")], failing);
    expect(result.status).toBe(500);
    expect(result.dataStatements).toEqual([]);
  });

  it("a missing department schema (42P01 / 42703) in the lookup: a linked Manager gets degraded answers (unfiltered) and the request does not fail; a stranger stays refused", async () => {
    for (const code of ["42P01", "42703"]) {
      resetDepartmentsFlagForTests();
      const result = await say("PO-B-V1", "mgra", (text) => {
        if (/LATERAL/.test(text)) throw Object.assign(new Error("missing"), { code });
      });
      expect(result.status, code).toBe(200);
      expect(poOf(result), code).toMatchObject({ po_number: "PO-B-V1" });
      // The fallback is NOT legacy: identity is still required while the switch is on (spec section 2 and the 5.1 ruling).
      const stranger = await say("PO-B-V1", "unlinked-id");
      expect(stranger.texts, code).toEqual([LINE_BOT_MESSAGES.unlinked]);
      expect(stranger.dataStatements, code).toEqual([]);
    }
  });
});

// Switch ON but departments not ready ("degraded"): either a route called markDepartmentsNotReady within the last 60 s, or the
// readiness probe itself hits a missing table. The bot still requires a linked, active account; staff get UNFILTERED answers (no
// department is known), PO/shipments still need Admin/Manager, a Vendor still sees only its own company.
describe("switch on, departments not ready (degraded)", () => {
  const PROBE = /to_regclass\('public\.user_departments'\)/;
  const modes: Array<[string, () => void, Intercept | undefined]> = [
    ["after markDepartmentsNotReady", () => markDepartmentsNotReady("test: another route saw a missing column"), undefined],
    ["when the probe cannot find the schema", () => undefined, (text) => {
      if (PROBE.test(text)) throw Object.assign(new Error('relation "user_departments" does not exist'), { code: "42P01" });
    }],
  ];

  for (const [mode, prepare, intercept] of modes) {
    describe(mode, () => {
      beforeEach(() => {
        prepare();
      });
      const ask = (text: string, username: string | null) => say(text, username, intercept);

      it("control: degraded is really in effect (mgra, a Manager of A, gets the PO, shipment and stock of department B, unfiltered)", async () => {
        const po = await ask("PO-B-V1", "mgra");
        expect(po.status).toBe(200);
        expect(poOf(po)).toMatchObject({ po_number: "PO-B-V1", vendor: "V1" });
        if (intercept) expect(po.statements.some((text) => PROBE.test(text))).toBe(true);
        expect(po.statements.some((text) => /LATERAL/.test(text))).toBe(false);
        expect(trackingOf(await ask("BB222222222TH", "mgra"))).toMatchObject({ trackingNo: "BB222222222TH" });
        expect(stockOf(await ask("stock dept b item", "mgra"))).toEqual(["MB-000001", "MB-000002"]);
      });

      const identities: Array<[string, string | null]> = [["unlinked LINE id", "unlinked-id"], ["inactive account", "inactive-account"], ["no source.userId", null]];
      for (const [identityName, username] of identities) {
        it.each(["PO-A-V1", "PO-B-V1", "AA111111111TH", "stock", "stock reagent", "stock งาน routine"])(`${identityName}: "%s" answers the unlinked message and reads no data`, async (text) => {
          const result = await ask(text, username);
          expect(result.status).toBe(200);
          expect(result.texts).toEqual([LINE_BOT_MESSAGES.unlinked]);
          expect(result.calls).toEqual(["lineClient.replyMessage"]);
          expect(result.dataStatements).toEqual([]);
        });
      }

      it("a linked User is refused PO and shipments (no data read) but may search stock (unfiltered)", async () => {
        for (const text of ["PO-A-V1", "PO-B-V1", "AA111111111TH", "BB222222222TH"]) {
          const result = await ask(text, "user-a");
          expect(result.texts, text).toEqual([LINE_BOT_MESSAGES.purchasingDenied]);
          expect(result.dataStatements, text).toEqual([]);
        }
        expect(stockOf(await ask("stock reagent 1", "user-a"))).toEqual(["LAB-000001"]);
        expect(stockOf(await ask("stock dept b item", "user-a"))).toEqual(["MB-000001", "MB-000002"]);
      });

      it("a Vendor sees only its own company's PO and shipment, and no stock", async () => {
        expect(poOf(await ask("PO-B-V1", "vendor-v1"))).toMatchObject({ po_number: "PO-B-V1", vendor: "V1" });
        expect((await ask("PO-B-V2", "vendor-v1")).texts).toEqual([notFoundPO("PO-B-V2")]);
        expect((await ask("CC333333333TH", "vendor-v1")).texts).toEqual([notFoundShipment("CC333333333TH")]);
        const stock = await ask("stock", "vendor-v1");
        expect(stock.texts).toEqual([LINE_BOT_MESSAGES.vendorStockDenied]);
        expect(stock.dataStatements).toEqual([]);
      });
    });
  }
});
