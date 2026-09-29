import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), auth: vi.fn() }));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/line-liff-ordering", () => ({ getLinePurchasingUserFromRequest: mocks.auth }));

import { POST } from "./route";

const queryText = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

describe("POST /api/liff/orders/bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ ok: true, user: { username: "mgr", name: "Manager", role: "Manager" }, body: {} });
    mocks.sql.mockResolvedValue([]);
  });

  it("lists orders waiting for Manager review and acknowledged orders, so a PO just created from LINE shows up", async () => {
    const response = await POST(new Request("http://test", { method: "POST", body: "{}" }));
    expect(response.status).toBe(200);

    const orderQuery = mocks.sql.mock.calls.map(queryText).find((text) => text.includes("FROM purchase_orders"));
    expect(orderQuery).toBeDefined();
    expect(orderQuery).toContain("'PENDING_MANAGER_REVIEW'");
    expect(orderQuery).toContain("'ACKNOWLEDGED'");
    // The statuses the Lab already reviews from LINE stay in the list.
    expect(orderQuery).toContain("'PENDING_LAB_REVIEW'");
    expect(orderQuery).toContain("'REVISION_REQUESTED'");
  });

  it("returns the auth failure response untouched", async () => {
    const denied = new Response(JSON.stringify({ error: "no" }), { status: 403 });
    mocks.auth.mockResolvedValue({ ok: false, response: denied });

    const response = await POST(new Request("http://test", { method: "POST", body: "{}" }));

    expect(response.status).toBe(403);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
