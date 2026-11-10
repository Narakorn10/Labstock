import { describe, expect, it } from "vitest";
import { knownUsageWindow } from "./usage-average";

// A count's refill covers the days before the count, so the real usage of an item is known only up to the day
// before its latest count. The average per day is taken over those days.

describe("knownUsageWindow", () => {
  it("uses the whole range when the item was never counted", () => {
    expect(knownUsageWindow("2026-11-03", "2026-11-10", null)).toEqual({ startDate: "2026-11-03", endDate: "2026-11-10", days: 8 });
    expect(knownUsageWindow("2026-11-03", "2026-11-10", undefined)).toEqual({ startDate: "2026-11-03", endDate: "2026-11-10", days: 8 });
  });

  it("stops the day before the latest count (the user's example: count on 10 Nov -> 3-9 Nov, 7 days)", () => {
    expect(knownUsageWindow("2026-11-03", "2026-11-10", "2026-11-10")).toEqual({ startDate: "2026-11-03", endDate: "2026-11-09", days: 7 });
  });

  it("stops earlier when the latest count was earlier than the end of the range", () => {
    expect(knownUsageWindow("2026-11-01", "2026-11-30", "2026-11-11")).toEqual({ startDate: "2026-11-01", endDate: "2026-11-10", days: 10 });
  });

  it("keeps the whole range when a count after the range spreads back into it", () => {
    expect(knownUsageWindow("2026-11-01", "2026-11-10", "2026-11-20")).toEqual({ startDate: "2026-11-01", endDate: "2026-11-10", days: 10 });
  });

  it("crosses a month boundary", () => {
    expect(knownUsageWindow("2026-10-20", "2026-11-05", "2026-11-01")).toEqual({ startDate: "2026-10-20", endDate: "2026-10-31", days: 12 });
  });

  it("gives one day when the count is the day after the start", () => {
    expect(knownUsageWindow("2026-11-03", "2026-11-10", "2026-11-04")).toEqual({ startDate: "2026-11-03", endDate: "2026-11-03", days: 1 });
  });

  it("gives no window when no whole day before the count is inside the range", () => {
    expect(knownUsageWindow("2026-11-03", "2026-11-10", "2026-11-03")).toBeNull();
    expect(knownUsageWindow("2026-11-03", "2026-11-10", "2026-10-01")).toBeNull();
  });

  it("gives no window for an empty or reversed range", () => {
    expect(knownUsageWindow("2026-11-10", "2026-11-03", null)).toBeNull();
  });
});
