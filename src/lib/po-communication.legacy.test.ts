import { beforeEach, describe, expect, it, vi } from "vitest";
import baseline from "./po-communication.legacy-baseline.json";

// With DEPARTMENTS_ENABLED off, recordPurchaseOrderCommunication must issue exactly the SQL it issued before departments
// (G5 PR-3). The baseline JSON was captured from the ORIGINAL code (git HEAD 1b0d944) with the same mock below, as
// [{ t: strings.join("?"), v: values }] for one PO_CREATED event with one Vendor recipient (LINE + EMAIL).
const mocks = vi.hoisted(() => ({ sql: vi.fn(), ready: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("next/server", () => ({ after: () => { throw new Error("no request scope"); } }));
vi.mock("@/lib/departments-flag", () => ({ departmentsReady: mocks.ready }));

import { recordPurchaseOrderCommunication } from "./po-communication";

function mockDb(po: Record<string, unknown>) {
  mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM purchase_orders p")) return Promise.resolve([po]);
    if (text.includes("INSERT INTO purchase_order_events")) return Promise.resolve([{ id: 67 }]);
    if (text.includes("FROM notification_settings")) return Promise.resolve([{ username: "pcl-1", role: "Vendor", line_user_id: "U1", email: "a@b.c" }]);
    if (text.includes("INSERT INTO notification_outbox")) return Promise.resolve([{ id: 1 }]);
    return Promise.resolve([]);
  });
}

const PO = { id: 22, po_number: "PO-22", vendor: "PCL", status: "SUBMITTED", items: [] };
const calls = () => mocks.sql.mock.calls.map((call) => ({ t: (call[0] as TemplateStringsArray).join("?"), v: call.slice(1) }));

describe("recordPurchaseOrderCommunication with departments off", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.ready.mockReset();
  });

  it("issues exactly the pre-departments queries (same text, same values, same order) and no department query", async () => {
    mocks.ready.mockResolvedValue(false);
    mockDb(PO);
    await recordPurchaseOrderCommunication({ poId: 22, eventType: "PO_CREATED", actor: { username: "5783", role: "Admin" } });

    expect(calls()).toEqual(baseline);
    for (const call of calls()) expect(call.t).not.toMatch(/user_departments|departments|department_id/);
  });

  it("ignores the PO's department_id column while the flag is off", async () => {
    mocks.ready.mockResolvedValue(false);
    mockDb({ ...PO, department_id: 2 });
    await recordPurchaseOrderCommunication({ poId: 22, eventType: "PO_CREATED", actor: { username: "5783", role: "Admin" } });

    expect(calls()).toEqual(baseline);
  });
});

describe("recordPurchaseOrderCommunication with departments ready (mocked sql)", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.ready.mockReset();
    mocks.ready.mockResolvedValue(true);
  });

  it("filters recipients by the PO's department and stamps the outbox with it, last", async () => {
    mockDb({ ...PO, department_id: 2 });
    await recordPurchaseOrderCommunication({ poId: 22, eventType: "PO_CREATED", actor: { username: "5783", role: "Admin" } });

    const recipientQuery = calls().find((call) => call.t.includes("FROM notification_settings"));
    expect(recipientQuery?.t).toContain("user_departments ud");
    expect(recipientQuery?.v).toEqual(["PCL", 2]);
    const outboxCalls = calls().filter((call) => call.t.includes("INSERT INTO notification_outbox"));
    expect(outboxCalls).toHaveLength(2);
    for (const call of outboxCalls) {
      expect(call.t).toContain("idempotency_key, department_id)");
      expect(call.v.at(-1)).toBe(2);
    }
  });

  it("fails closed without throwing when the PO has no valid department", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const department_id of [null, undefined, 0, -1, 1.5, "abc"]) {
      mocks.sql.mockReset();
      mockDb({ ...PO, department_id });
      const result = await recordPurchaseOrderCommunication({ poId: 22, eventType: "PO_CREATED", actor: { username: "5783", role: "Admin" } });

      expect(result).toEqual({ eventId: 67, queued: 0 });
      expect(calls().some((call) => call.t.includes("INSERT INTO purchase_order_events"))).toBe(true);
      expect(calls().some((call) => call.t.includes("FROM notification_settings"))).toBe(false);
      expect(calls().some((call) => call.t.includes("INSERT INTO notification_outbox"))).toBe(false);
    }
    expect(errorSpy).toHaveBeenCalledTimes(6);
    errorSpy.mockRestore();
  });
});
