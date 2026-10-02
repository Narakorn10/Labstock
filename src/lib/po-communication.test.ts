import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("next/server", () => ({ after: () => { throw new Error("no request scope"); } }));

import { recordPurchaseOrderCommunication, shouldNotifyRecipient, shouldSendLine } from "./po-communication";

describe("PO communication recipients", () => {
  it("never notifies anyone when the Lab confirms receipt", () => {
    for (const recipientRole of ["Admin", "Manager", "Vendor", "User"]) {
      for (const actorRole of ["Admin", "Manager", "Vendor", undefined]) {
        expect(shouldNotifyRecipient("PO_LAB_RECEIPT_CONFIRMED", actorRole, recipientRole)).toBe(false);
      }
    }
  });

  it("still notifies the Vendor about the existing received event", () => {
    expect(shouldNotifyRecipient("PO_RECEIVED", "Manager", "Vendor")).toBe(true);
  });
});

describe("LINE scope", () => {
  it("sends LINE only to the Vendor for a new Lab order", () => {
    expect(shouldSendLine("PO_CREATED", "Vendor", "APPROVE_MANAGER_REVIEW")).toBe(true);
  });

  it("does not send LINE when the Lab edits an order the Vendor has not acknowledged", () => {
    expect(shouldSendLine("PO_CREATED", "Vendor", "UPDATE_UNACKNOWLEDGED_LAB_ORDER")).toBe(false);
  });

  it("does not send LINE for overdue reminders or status changes", () => {
    for (const event of ["VENDOR_RESPONSE_OVERDUE", "DELIVERY_OVERDUE", "PO_REVIEW_REQUIRED", "PO_CONFIRMED", "PO_STATUS_UPDATED", "PO_SHIPPED", "PO_RECEIVED", "PO_CANCELLED"] as const) {
      for (const role of ["Admin", "Manager", "Vendor"]) {
        expect(shouldSendLine(event, role)).toBe(false);
      }
    }
  });
});

type Recipient = { username: string; role: string; line_user_id: string | null; email: string | null };

function mockDb(recipients: Recipient[]) {
  mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM purchase_orders p")) {
      return Promise.resolve([{ id: 22, po_number: "PO-22", vendor: "PCL", status: "SUBMITTED", items: [] }]);
    }
    if (text.includes("INSERT INTO purchase_order_events")) return Promise.resolve([{ id: 67 }]);
    if (text.includes("FROM notification_settings")) return Promise.resolve(recipients);
    if (text.includes("INSERT INTO notification_outbox")) return Promise.resolve([{ id: 1 }]);
    return Promise.resolve([]);
  });
}

function queuedOutbox() {
  // Template values: eventId, eventType, poId, shipmentId, username, role, channel, address, ...
  return mocks.sql.mock.calls
    .filter((call) => (call[0] as TemplateStringsArray).join("?").includes("INSERT INTO notification_outbox"))
    .map((call) => ({ channel: call[7], address: call[8] }));
}

describe("recordPurchaseOrderCommunication", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
  });

  it("queues one LINE message per LINE account even when it is linked to several usernames", async () => {
    mockDb([
      { username: "pcl-1", role: "Vendor", line_user_id: "U-same-phone", email: null },
      { username: "pcl-2", role: "Vendor", line_user_id: "U-same-phone", email: null },
    ]);
    await recordPurchaseOrderCommunication({
      poId: 22,
      eventType: "PO_CREATED",
      actor: { username: "5783", role: "Admin" },
      metadata: { action: "APPROVE_MANAGER_REVIEW" },
    });
    expect(queuedOutbox()).toEqual([{ channel: "LINE", address: "U-same-phone" }]);
  });

  it("keeps overdue reminders off LINE but still emails the Lab", async () => {
    mockDb([
      { username: "admin", role: "Admin", line_user_id: "U-admin", email: "admin@lab.test" },
      { username: "7268", role: "Manager", line_user_id: "U-manager", email: null },
    ]);
    await recordPurchaseOrderCommunication({ poId: 22, eventType: "VENDOR_RESPONSE_OVERDUE", source: "SYSTEM" });
    expect(queuedOutbox()).toEqual([{ channel: "EMAIL", address: "admin@lab.test" }]);
  });
});
