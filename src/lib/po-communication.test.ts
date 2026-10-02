import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: vi.fn() }));

import { shouldNotifyRecipient } from "./po-communication";

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
