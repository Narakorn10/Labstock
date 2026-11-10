import { describe, expect, it } from "vitest";
import { toLocalIsoDate } from "@/lib/local-date";

describe("toLocalIsoDate", () => {
  it("returns the local calendar date in any server timezone", () => {
    const originalTz = process.env.TZ;
    try {
      for (const tz of ["Asia/Bangkok", "UTC", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        expect(toLocalIsoDate(new Date(2026, 10, 1)), `TZ=${tz}`).toBe("2026-11-01");
        expect(toLocalIsoDate(new Date(2026, 0, 5, 23, 59)), `TZ=${tz}`).toBe("2026-01-05");
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});
