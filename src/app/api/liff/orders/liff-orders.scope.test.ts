import { beforeEach, describe, expect, it, vi } from "vitest";

// Two things the PGlite tests (liff-orders.dept.db.test.ts) cannot reach, with the gate (line-liff-ordering) mocked:
//  1. PATCH passes the REAL scope of the user to applyLabReviewDecision (second layer behind the scoped SELECT: the
//     SELECT answers 404 for another department first, so a DB test cannot tell a wrong scope here).
//  2. If the gate ever hands back a user WITHOUT a scope while departments are ready, every route fails closed with the
//     catalogue 500 (DEPARTMENT_SCOPE_MISSING -> INTERNAL_ERROR with a requestId), not the route's generic 500.

const mocks = vi.hoisted(() => ({
  sql: Object.assign(vi.fn(), { unsafe: vi.fn((text: string) => text) }),
  auth: vi.fn(),
  ready: vi.fn(),
  applyLabReviewDecision: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/line-liff-ordering", () => ({
  getLinePurchasingUserFromRequest: mocks.auth,
  purchaseOrderHasLiffRequestColumn: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/departments-flag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/departments-flag")>()),
  departmentsReady: mocks.ready,
}));
vi.mock("@/lib/purchase-order-review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/purchase-order-review")>()),
  applyLabReviewDecision: mocks.applyLabReviewDecision,
}));
vi.mock("@/lib/po-communication", () => ({ recordPurchaseOrderCommunication: mocks.record }));

import { POST as bootstrapPOST } from "./bootstrap/route";
import { POST as catalogPOST } from "./catalog/search/route";
import { POST as ordersPOST } from "./route";
import { PATCH as orderPATCH } from "./[id]/route";

const scoped = { username: "mgrb", name: "Manager B", role: "Manager", globalRole: "Manager", departmentId: 2, departmentCode: "MB", scope: 2 };
const unscoped = { username: "mgrb", name: "Manager B", role: "Manager" };
const body = { vendor: "MB Vendor", items: [{ item_id: "MB-000001", item_name: "Item", quantity: 3, unit: "box", override_reason: "t" }], action: "APPROVE_REVISION" };
const gate = (user: unknown) => mocks.auth.mockResolvedValue({ ok: true, user, lineUserId: "U-1", body });
const post = () => new Request("http://localhost/x", { method: "POST", body: "{}" });
const patch = () => orderPATCH(new Request("http://localhost/x", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ id: "3" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.ready.mockResolvedValue(true);
  mocks.sql.mockResolvedValue([{ id: 3, po_number: "PO-3", status: "REVISION_REQUESTED", confirmed_at: null }]);
  mocks.applyLabReviewDecision.mockResolvedValue(true);
});

describe("PATCH /api/liff/orders/[id]: second layer", () => {
  it("passes the user's real scope to applyLabReviewDecision (not legacy)", async () => {
    gate(scoped);
    const response = await patch();
    expect(response.status).toBe(200);
    expect(mocks.applyLabReviewDecision).toHaveBeenCalledTimes(1);
    expect(mocks.applyLabReviewDecision.mock.calls[0][1]).toMatchObject({
      po: { id: 3, status: "REVISION_REQUESTED" },
      reviewer: "mgrb",
      scope: { mode: "one", departmentId: 2 },
    });
  });
});

describe("a gate that returns a user without scope while departments are ready fails closed", () => {
  const routes: Array<[string, () => Promise<Response>]> = [
    ["bootstrap", () => bootstrapPOST(post())],
    ["catalog/search", () => catalogPOST(post())],
    ["orders POST", () => ordersPOST(post())],
    ["orders/[id] PATCH", patch],
  ];

  it.each(routes)("%s answers the catalogue 500 with a requestId and touches no data", async (_name, call) => {
    gate(unscoped);
    const response = await call();
    expect(response.status).toBe(500);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(typeof json.requestId).toBe("string");
    expect(response.headers.get("x-request-id")).toBe(json.requestId);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.applyLabReviewDecision).not.toHaveBeenCalled();
  });
});
