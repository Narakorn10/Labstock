import { describe, expect, it } from "vitest";
import type { Reagent } from "@/lib/api-client";
import { getMobileFocusStats, toLocalDateString } from "./mobile-focus-stats";

const reagent = (overrides: Partial<Reagent> & { lots: Reagent["lots"] }): Reagent => ({
  itemId: "R1",
  qrCode: "",
  name: "Reagent",
  reagentType: "",
  jobType: "",
  machineType: "",
  unit: "box",
  minThreshold: 2,
  weeklyTarget: 0,
  quantity: 10,
  ...overrides,
});

const lot = (lotNo: string, expDate: string, qty = 1) => ({ inventoryId: 1, lotNo, expDate, receivedOn: "2026-01-01", qty });

describe("getMobileFocusStats", () => {
  const today = "2026-09-28";

  it("counts expired, near-expiry (<= 30 days) and low-stock separately", () => {
    const stats = getMobileFocusStats(
      [
        reagent({ itemId: "A", name: "A", quantity: 1, lots: [lot("EXP", "2026-09-20"), lot("NEAR", "2026-10-08")] }),
        reagent({ itemId: "B", name: "B", quantity: 9, lots: [lot("EDGE", "2026-10-28"), lot("FAR", "2026-10-29")] }),
      ],
      today,
    );

    expect(stats.expiredLots).toBe(1);
    expect(stats.nearExpiryLots).toBe(2); // NEAR + EDGE (exactly 30 days), not FAR (31 days)
    expect(stats.belowMin).toBe(1);
  });

  it("treats quantity equal to the minimum as low, like the desktop dashboard", () => {
    const stats = getMobileFocusStats([reagent({ quantity: 2, minThreshold: 2, lots: [] })], today);
    expect(stats.belowMin).toBe(1);
  });

  it("does not count a lot that expires today as expired", () => {
    const stats = getMobileFocusStats([reagent({ lots: [lot("TODAY", today)] })], today);
    expect(stats.expiredLots).toBe(0);
    expect(stats.nearExpiryLots).toBe(1);
    expect(stats.watchList[0].daysLeft).toBe(0);
  });

  it("orders the watch list expired first, then soonest expiry", () => {
    const stats = getMobileFocusStats(
      [reagent({ lots: [lot("SOON", "2026-10-10"), lot("OLD", "2026-08-01"), lot("OLDER", "2026-07-01"), lot("SOONEST", "2026-09-30")] })],
      today,
    );
    expect(stats.watchList.map((item) => item.lotNo)).toEqual(["OLDER", "OLD", "SOONEST", "SOON"]);
  });

  it("ignores lots with a missing or unparsable expiry date", () => {
    const stats = getMobileFocusStats([reagent({ lots: [lot("BLANK", ""), lot("BAD", "n/a")] })], today);
    expect(stats.watchList).toEqual([]);
    expect(stats.expiredLots + stats.nearExpiryLots).toBe(0);
  });

  it("returns zeros for an unparsable today value", () => {
    expect(getMobileFocusStats([reagent({ lots: [lot("X", "2026-01-01")] })], "bad")).toEqual({
      expiredLots: 0,
      belowMin: 0,
      nearExpiryLots: 0,
      watchList: [],
    });
  });
});

describe("toLocalDateString", () => {
  it("formats the local calendar date with zero padding", () => {
    expect(toLocalDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
