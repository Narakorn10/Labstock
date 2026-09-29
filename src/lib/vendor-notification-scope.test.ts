import { describe, expect, it } from "vitest";
import { itemsForVendor, splitRecipientsByVendor } from "./vendor-notification-scope";

describe("splitRecipientsByVendor", () => {
  it("keeps staff together and vendors separate with their vendor name", () => {
    const { staff, vendors } = splitRecipientsByVendor([
      { username: "a", role: "Admin", vendor: null },
      { username: "b", role: "Vendor", vendor: " บริษัท A " },
      { username: "c", role: "User" },
    ]);
    expect(staff.map((r) => r.username)).toEqual(["a", "c"]);
    expect(vendors).toHaveLength(1);
    expect(vendors[0].vendor).toBe("บริษัท A");
  });

  it("drops a Vendor account that has no vendor name (fail closed)", () => {
    const { staff, vendors } = splitRecipientsByVendor([
      { username: "x", role: "Vendor", vendor: "" },
      { username: "y", role: "Vendor", vendor: null },
      { username: "z", role: "Vendor" },
    ]);
    expect(staff).toEqual([]);
    expect(vendors).toEqual([]);
  });
});

describe("itemsForVendor", () => {
  const items = [
    { itemId: "1", vendor: "A" },
    { itemId: "2", vendor: "B" },
    { itemId: "3", vendor: "" },
    { itemId: "4" },
  ];

  it("returns only that vendor's items", () => {
    expect(itemsForVendor(items, "A").map((i) => i.itemId)).toEqual(["1"]);
    expect(itemsForVendor(items, "B").map((i) => i.itemId)).toEqual(["2"]);
  });

  it("never returns items with no vendor, and nothing for an empty vendor", () => {
    expect(itemsForVendor(items, "").length).toBe(0);
    expect(itemsForVendor(items, "C")).toEqual([]);
  });
});
