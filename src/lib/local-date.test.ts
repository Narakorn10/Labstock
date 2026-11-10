import { describe, expect, it } from "vitest";
import { isReasonableIsoDate, resolveDateInput } from "./local-date";

describe("isReasonableIsoDate", () => {
  it("accepts a full YYYY-MM-DD date from the year 2000 on", () => {
    expect(isReasonableIsoDate("2026-11-10")).toBe(true);
    expect(isReasonableIsoDate("2000-01-01")).toBe(true);
  });

  it("rejects the half typed year a date input sends while typing", () => {
    expect(isReasonableIsoDate("0002-11-10")).toBe(false);
    expect(isReasonableIsoDate("0202-11-10")).toBe(false);
    expect(isReasonableIsoDate("1999-12-31")).toBe(false);
  });

  it("rejects an empty value, a wrong shape and an impossible date", () => {
    expect(isReasonableIsoDate("")).toBe(false);
    expect(isReasonableIsoDate("2026-11")).toBe(false);
    expect(isReasonableIsoDate("20261-11-10")).toBe(false);
    expect(isReasonableIsoDate("2026-13-45")).toBe(false);
  });
});

describe("resolveDateInput", () => {
  const today = "2026-11-10";

  it("does not commit a half typed year", () => {
    expect(resolveDateInput("0002-11-10", "2026-11-10", "start", today)).toEqual({});
    expect(resolveDateInput("0002-11-10", "2026-01-01", "end", today)).toEqual({});
    expect(resolveDateInput("", "2026-11-10", "start", today)).toEqual({});
  });

  it("commits a complete start date and keeps the end", () => {
    expect(resolveDateInput("2026-08-01", "2026-11-10", "start", today)).toEqual({
      commit: { start: "2026-08-01", end: "2026-11-10" }
    });
  });

  it("pulls a start date after the end back to the end", () => {
    expect(resolveDateInput("2026-12-01", "2026-11-05", "start", today)).toEqual({
      commit: { start: "2026-11-05", end: "2026-11-05" }
    });
  });

  it("clamps an end date past today to today", () => {
    expect(resolveDateInput("2027-01-01", "2026-08-01", "end", today)).toEqual({
      commit: { start: "2026-08-01", end: today }
    });
  });

  it("pushes an end date before the start up to the start", () => {
    expect(resolveDateInput("2026-07-01", "2026-08-01", "end", today)).toEqual({
      commit: { start: "2026-08-01", end: "2026-08-01" }
    });
  });
});
