import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ default: vi.fn() }));
import { normalizeAllocations, requiredQty } from "./count-work-orders";

describe("count work order invariants", () => {
  it("never proposes a negative refill", () => {
    expect(requiredQty(10, 12)).toBe(0);
    expect(requiredQty(10, 3)).toBe(7);
  });

  it("groups split selections for the same lot", () => {
    expect(normalizeAllocations([
      { itemId: "R1", inventoryId: 8, qty: 2 },
      { itemId: "r1", inventoryId: 8, qty: 3 },
      { itemId: "R1", inventoryId: 9, qty: 1 },
    ])).toEqual([
      { itemId: "R1", inventoryId: 8, qty: 5 },
      { itemId: "R1", inventoryId: 9, qty: 1 },
    ]);
  });

  it("rejects malformed or non-positive lot allocations", () => {
    expect(() => normalizeAllocations([{ itemId: "", inventoryId: 1, qty: 1 }])).toThrow();
    expect(() => normalizeAllocations([{ itemId: "R1", inventoryId: 1, qty: 0 }])).toThrow();
  });
});
