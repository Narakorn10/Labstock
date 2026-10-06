import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: vi.fn() }));

import { computeReorderInsight } from "./reagent-usage-insights";

describe("computeReorderInsight", () => {
  it("is normal with no usage and stock above min", () => {
    expect(computeReorderInsight(10, 2, 0)).toEqual({
      quantity: 10, minThreshold: 2, dispensedLast90Days: 0,
      averageDailyUsage: 0, daysUntilMin: null, status: "normal", recommendedOrderQty: 0,
    });
  });

  it("is critical at or below min", () => {
    expect(computeReorderInsight(2, 2, 0).status).toBe("critical");
  });

  it("is critical when min is reached within the lead time", () => {
    // 90/90 = 1 per day, (8-2)/1 = 6 days <= 7; target = ceil(14*1 + 2) = 16
    expect(computeReorderInsight(8, 2, 90)).toMatchObject({ daysUntilMin: 6, status: "critical", recommendedOrderQty: 8 });
  });

  it("is reorder when min is reached within lead time + review period", () => {
    expect(computeReorderInsight(12, 2, 90)).toMatchObject({ daysUntilMin: 10, status: "reorder", recommendedOrderQty: 4 });
  });

  it("is normal when min is further away", () => {
    expect(computeReorderInsight(30, 2, 90)).toMatchObject({ daysUntilMin: 28, status: "normal", recommendedOrderQty: 0 });
  });
});
