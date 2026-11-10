import { describe, expect, it, vi } from "vitest";

// real-usage.ts imports the database client; the pure spreading logic below never touches it.
vi.mock("@/lib/db", () => ({ default: vi.fn() }));

import { FIRST_COUNT_SPREAD_DAYS, spreadRefillEvents, type CountEvent } from "./real-usage";

const refill = (date: string, qty: number, itemId = "R1", name = "น้ำยา 1"): CountEvent => ({ itemId, name, date, qty, kind: "refill" });
const zero = (date: string, itemId = "R1", name = "น้ำยา 1"): CountEvent => ({ itemId, name, date, qty: 0, kind: "zero" });

/** days of one item as { date: units } */
function daysOf(events: CountEvent[], key = "r1") {
  const entry = spreadRefillEvents(events).get(key);
  return Object.fromEntries([...(entry?.days ?? [])].map(([date, cents]) => [date, cents / 100]));
}

describe("spreadRefillEvents", () => {
  it("spreads a refill evenly from the previous count to the day before this count (user example)", () => {
    const days = daysOf([refill("2026-11-03", 6), refill("2026-11-10", 7)]);
    // 7 units over 3-9 Nov, nothing on 10 Nov
    for (const day of ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]) {
      expect(days[day], day).toBe(1);
    }
    expect(days["2026-11-10"]).toBeUndefined();
    // first count (6) has no previous count: 7 days before 3 Nov
    expect(days["2026-10-27"]).toBeCloseTo(0.85, 2);
    expect(days["2026-11-02"]).toBeCloseTo(0.86, 2);
  });

  it("spreads the first count over the 7 days before it", () => {
    expect(FIRST_COUNT_SPREAD_DAYS).toBe(7);
    const days = daysOf([refill("2026-11-10", 7)]);
    expect(Object.keys(days)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
    expect(Object.values(days).every((value) => value === 1)).toBe(true);
  });

  it("puts the leftover cents on the last days (10 over 3 days = 3.33, 3.33, 3.34)", () => {
    const days = daysOf([refill("2026-11-01", 1), refill("2026-11-04", 10)]);
    expect(days["2026-11-01"]).toBeCloseTo(3.33, 2);
    expect(days["2026-11-02"]).toBeCloseTo(3.33, 2);
    expect(days["2026-11-03"]).toBeCloseTo(3.34, 2);
    expect(days["2026-11-01"] + days["2026-11-02"] + days["2026-11-03"]).toBeCloseTo(10, 2);
  });

  it("keeps the leftover on the days nearest the count date (6 over 7 days = .85 .85 .86 x5)", () => {
    const days = daysOf([refill("2026-11-03", 6)]);
    expect(Object.values(days)).toEqual([0.85, 0.85, 0.86, 0.86, 0.86, 0.86, 0.86]);
    expect(Object.keys(days)[6]).toBe("2026-11-02");
  });

  it("rounds a quantity with more than 2 decimals to cents without losing more than half a cent", () => {
    const days = daysOf([refill("2026-11-01", 1), refill("2026-11-02", 2.555)]);
    expect(days["2026-11-01"]).toBeCloseTo(2.555, 2);
  });

  it("merges two counts of the same item on the same day", () => {
    const days = daysOf([refill("2026-11-01", 1), refill("2026-11-03", 2), refill("2026-11-03", 4)]);
    // one event of 6 over 1-2 Nov
    expect(days["2026-11-01"]).toBe(3);
    expect(days["2026-11-02"]).toBe(3);
  });

  it("uses a count that needs no refill as a boundary without adding any quantity", () => {
    const days = daysOf([refill("2026-11-03", 7), zero("2026-11-06"), refill("2026-11-10", 4)]);
    // the 4 units go only over 6-9 Nov (not back to 3 Nov)
    expect(days["2026-11-06"]).toBe(1);
    expect(days["2026-11-09"]).toBe(1);
    expect(days["2026-11-05"]).toBeUndefined();
    const total = Object.values(days).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(7 + 4, 2); // the zero event adds nothing
  });

  it("a zero event that is the first count adds nothing at all", () => {
    expect(daysOf([zero("2026-11-06")])).toEqual({});
  });

  it("never puts quantity on or after the count date", () => {
    const days = daysOf([refill("2026-11-03", 5), refill("2026-11-10", 5)]);
    expect(Object.keys(days).every((date) => date < "2026-11-10")).toBe(true);
  });

  it("treats r1 and R1 as one item", () => {
    const map = spreadRefillEvents([refill("2026-11-03", 7, "r1"), refill("2026-11-10", 7, "R1", "Master")]);
    expect(map.size).toBe(1);
    const entry = map.get("r1")!;
    expect(entry.days.get("2026-11-09")).toBe(100);
    // the previous count (r1) is the boundary: 7 units over 3-9 Nov
    expect(entry.days.get("2026-11-03")).toBe(100);
  });

  it("keeps different items apart", () => {
    const map = spreadRefillEvents([refill("2026-11-10", 7, "R1"), refill("2026-11-10", 14, "R2")]);
    expect(map.get("r1")!.days.get("2026-11-09")).toBe(100);
    expect(map.get("r2")!.days.get("2026-11-09")).toBe(200);
  });

  it("skips an event whose count date is missing without throwing", () => {
    const events = [{ ...refill("2026-11-10", 7), date: null }, refill("2026-11-10", 7, "R2")] as unknown as CountEvent[];
    expect(() => spreadRefillEvents(events)).not.toThrow();
    const map = spreadRefillEvents(events);
    expect(map.has("r1")).toBe(false);
    expect(map.get("r2")!.days.size).toBe(7);
  });
});
