import { describe, expect, it } from "vitest";
import { bangkokToday, clampToToday } from "./bangkok-date";

describe("bangkokToday", () => {
  it("returns the Thai calendar day even when UTC is still on the previous day", () => {
    expect(bangkokToday(new Date("2026-11-09T18:30:00Z"))).toBe("2026-11-10");
  });

  it("switches day exactly at 17:00 UTC (00:00 Thai time)", () => {
    expect(bangkokToday(new Date("2026-11-09T16:59:59Z"))).toBe("2026-11-09");
    expect(bangkokToday(new Date("2026-11-09T17:00:00Z"))).toBe("2026-11-10");
  });

  it("does not depend on the server timezone", () => {
    const originalTz = process.env.TZ;
    try {
      for (const tz of ["Asia/Bangkok", "UTC", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        expect(bangkokToday(new Date("2026-11-09T18:30:00Z")), `TZ=${tz}`).toBe("2026-11-10");
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

describe("clampToToday", () => {
  const now = new Date("2026-11-09T18:30:00Z"); // 10 Nov in Thailand

  it("keeps a date that is today or earlier", () => {
    expect(clampToToday("2026-11-10", now)).toBe("2026-11-10");
    expect(clampToToday("2026-10-01", now)).toBe("2026-10-01");
  });

  it("pulls a future date back to today in Thailand", () => {
    expect(clampToToday("2026-11-11", now)).toBe("2026-11-10");
    expect(clampToToday("2099-12-31", now)).toBe("2026-11-10");
  });
});
