import { describe, expect, it } from "vitest";
import { checkRoomCode, cleanText } from "./room-code";

describe("checkRoomCode", () => {
  it("accepts 2-10 letters/digits and stores them upper case", () => {
    expect(checkRoomCode("MB")).toEqual({ ok: true, code: "MB" });
    expect(checkRoomCode(" mob2 ")).toEqual({ ok: true, code: "MOB2" });
    expect(checkRoomCode("ABCDEFGHI9")).toEqual({ ok: true, code: "ABCDEFGHI9" });
  });
  it("refuses wrong length, symbols, spaces inside, Thai letters and non-strings", () => {
    for (const bad of ["", "A", "ABCDEFGHIJK", "A-B", "A B", "ก๑", "MB!", null, undefined, 12, {}]) {
      expect(checkRoomCode(bad)).toEqual({ ok: false, reason: "format" });
    }
  });
  it("refuses LAB in any case (old item ids start with LAB-)", () => {
    expect(checkRoomCode("LAB")).toEqual({ ok: false, reason: "reserved" });
    expect(checkRoomCode("lab")).toEqual({ ok: false, reason: "reserved" });
  });
  it("still accepts codes that merely contain LAB", () => {
    expect(checkRoomCode("LAB2")).toEqual({ ok: true, code: "LAB2" });
  });
});

describe("cleanText", () => {
  it("trims and enforces the limit", () => {
    expect(cleanText("  ห้องใหม่ ", 20)).toBe("ห้องใหม่");
    expect(cleanText("x".repeat(21), 20)).toBeNull();
    expect(cleanText("   ", 20)).toBeNull();
    expect(cleanText(5, 20)).toBeNull();
  });
  it("refuses control characters", () => {
    expect(cleanText("a\nb", 20)).toBeNull();
    expect(cleanText("a\u0000b", 20)).toBeNull();
  });
});
