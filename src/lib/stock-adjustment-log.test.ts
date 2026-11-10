import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_ACTION_PREFIX,
  buildAdjustmentAction,
  describeAdjustment,
  isAdjustmentAction,
  parseAdjustmentAction,
  sanitizeReason,
} from "./stock-adjustment-log";

// The adjustment log has no column for the old quantity or the reason, so they are written after the fixed action
// text: "<prefix> | ยอด 10 → 8 | Lot A → B | EXP 2027-01-01 → 2027-02-01 | เหตุผล: นับจริง".

const base = { oldQty: 10, newQty: 8, oldLot: "L1", newLot: "L1", oldExp: "2027-01-01", newExp: "2027-01-01" };

describe("isAdjustmentAction", () => {
  it("matches the three texts the system has written and nothing else", () => {
    expect(isAdjustmentAction("ปรับปรุงยอดสต๊อก (Reconciliation)")).toBe(true);
    expect(isAdjustmentAction("ปรับปรุง lot/exp/qty (Reconciliation)")).toBe(true);
    expect(isAdjustmentAction("ปรับปรุงยอด (Adjustment)")).toBe(true);
    expect(isAdjustmentAction(`${ADJUSTMENT_ACTION_PREFIX} | ยอด 10 → 8`)).toBe(true);
    for (const other of ["เบิกไปหน้างาน", "รับเข้าสต๊อกหลัก", "ยืมเข้าคลัง", "เบิกเติมจากใบงานนับสต็อก", ""]) {
      expect(isAdjustmentAction(other), other).toBe(false);
    }
  });
});

describe("buildAdjustmentAction", () => {
  it("starts with the fixed text and shows old -> new quantity", () => {
    expect(buildAdjustmentAction(base)).toBe(`${ADJUSTMENT_ACTION_PREFIX} | ยอด 10 → 8`);
  });

  it("adds lot and expiry only when they changed, and the reason when given", () => {
    const text = buildAdjustmentAction({ ...base, newLot: "L2", newExp: "2027-02-01", reason: "นับจริง" });
    expect(text).toBe(`${ADJUSTMENT_ACTION_PREFIX} | ยอด 10 → 8 | Lot L1 → L2 | EXP 2027-01-01 → 2027-02-01 | เหตุผล: นับจริง`);
  });

  it("leaves out an empty reason", () => {
    expect(buildAdjustmentAction({ ...base, reason: "   " })).toBe(`${ADJUSTMENT_ACTION_PREFIX} | ยอด 10 → 8`);
    expect(buildAdjustmentAction({ ...base, reason: null })).toBe(`${ADJUSTMENT_ACTION_PREFIX} | ยอด 10 → 8`);
  });

  it("keeps decimal quantities as they are", () => {
    expect(buildAdjustmentAction({ ...base, oldQty: 2.5, newQty: 0 })).toBe(`${ADJUSTMENT_ACTION_PREFIX} | ยอด 2.5 → 0`);
  });

  it("records a lot change even when the cleaned texts of the old and new lot are the same", () => {
    // the database lot "A|B" becomes "A/B": after cleaning both read "A/B", but the lot did change
    expect(buildAdjustmentAction({ ...base, oldLot: "A|B", newLot: "A/B" })).toContain("| Lot A/B → A/B");
    const long = "x".repeat(70);
    expect(buildAdjustmentAction({ ...base, oldLot: `${long}1`, newLot: `${long}2` })).toContain("| Lot ");
    expect(buildAdjustmentAction({ ...base, oldExp: "2027-01-01 ", newExp: "2027-01-01" })).not.toContain("EXP"); // only spaces differ: no change
  });

  it("shows a missing expiry date as - (an empty one is not a change when both are empty)", () => {
    expect(buildAdjustmentAction({ ...base, oldExp: null, newExp: null })).toBe(`${ADJUSTMENT_ACTION_PREFIX} | ยอด 10 → 8`);
    expect(buildAdjustmentAction({ ...base, oldExp: null, newExp: "2027-03-01" })).toContain("| EXP - → 2027-03-01");
  });
});

describe("sanitizeReason", () => {
  it("turns line breaks and control characters into a single space", () => {
    expect(sanitizeReason("นับ\nจริง\r\n\tแล้ว")).toBe("นับ จริง แล้ว");
  });

  it("replaces the separator so the text can be read back unambiguously", () => {
    expect(sanitizeReason("a | b |c")).toBe("a / b /c");
  });

  it("removes the characters that break Telegram messages and CSV export", () => {
    expect(sanitizeReason('a <b> & "c"')).toBe("a b c");
  });

  it("trims, collapses spaces and caps the length", () => {
    expect(sanitizeReason("  x    y  ")).toBe("x y");
    expect(sanitizeReason("ก".repeat(500))).toHaveLength(120);
  });

  it("gives an empty string for empty, blank or non-text input", () => {
    expect(sanitizeReason("")).toBe("");
    expect(sanitizeReason("  \n ")).toBe("");
    expect(sanitizeReason(undefined)).toBe("");
    expect(sanitizeReason(42 as unknown as string)).toBe("");
  });
});

describe("parseAdjustmentAction", () => {
  it("reads back what buildAdjustmentAction wrote (lot and expiry changes are kept as plain text)", () => {
    const text = buildAdjustmentAction({ ...base, oldQty: 2.5, newQty: 7, newLot: "L2", newExp: "2027-02-01", reason: "น้ำยาหยดหาย | ล้างเครื่อง" });
    expect(parseAdjustmentAction(text)).toEqual({
      oldQty: 2.5,
      newQty: 7,
      changes: ["Lot L1 → L2", "EXP 2027-01-01 → 2027-02-01"],
      reason: "น้ำยาหยดหาย / ล้างเครื่อง",
    });
  });

  it("a lot number with the separator or a fake quantity cannot forge the quantity part", () => {
    const text = buildAdjustmentAction({ ...base, oldQty: 10, newQty: 8, newLot: "X | ยอด 0 → 999", reason: "เบิก | รับเข้า" });
    const parsed = parseAdjustmentAction(text)!;
    expect(parsed.oldQty).toBe(10);
    expect(parsed.newQty).toBe(8);
    expect(text.split(" | ").filter((part) => part.startsWith("ยอด "))).toHaveLength(1);
  });

  it("everything after the first reason marker is the reason, even when it looks like another part", () => {
    const text = `${ADJUSTMENT_ACTION_PREFIX} | ยอด 1 → 2 | เหตุผล: x | ยอด 5 → 9 | เหตุผล: y`;
    expect(parseAdjustmentAction(text)).toMatchObject({ oldQty: 1, newQty: 2, reason: "x | ยอด 5 → 9 | เหตุผล: y" });
  });

  it("gives nulls for the old texts that carry no details", () => {
    const none = { oldQty: null, newQty: null, changes: [], reason: null };
    expect(parseAdjustmentAction("ปรับปรุงยอดสต๊อก (Reconciliation)")).toEqual(none);
    expect(parseAdjustmentAction("ปรับปรุง lot/exp/qty (Reconciliation)")).toEqual(none);
    expect(parseAdjustmentAction("ปรับปรุงยอด (Adjustment)")).toEqual(none);
  });

  it("returns null for an action that is not an adjustment", () => {
    expect(parseAdjustmentAction("เบิกไปหน้างาน")).toBeNull();
  });

  it("ignores a part it does not understand and keeps the rest", () => {
    expect(parseAdjustmentAction(`${ADJUSTMENT_ACTION_PREFIX} | ยอด x → y | อะไรสักอย่าง | เหตุผล: ok`)).toEqual({
      oldQty: null, newQty: null, changes: [], reason: "ok",
    });
  });

  it("reads a reason that contains a colon", () => {
    expect(parseAdjustmentAction(`${ADJUSTMENT_ACTION_PREFIX} | ยอด 1 → 2 | เหตุผล: a: b`)?.reason).toBe("a: b");
  });
});

describe("describeAdjustment", () => {
  const detailed = (o: number, n: number) => buildAdjustmentAction({ ...base, oldQty: o, newQty: n });
  const describe_ = (action: string, qty: number) => describeAdjustment(action, qty);

  it("shows the change with a sign (ASCII minus) and the old -> new quantity", () => {
    expect(describe_(detailed(10, 8), 8)).toEqual({ deltaText: "-2", rangeText: "10 → 8" });
    expect(describe_(detailed(3, 5), 5)).toEqual({ deltaText: "+2", rangeText: "3 → 5" });
    expect(describe_(detailed(4, 4), 4)).toEqual({ deltaText: "0", rangeText: "4 → 4" });
  });

  it("rounds a decimal change to 2 places", () => {
    expect(describe_(detailed(0.1, 0.3), 0.3)).toEqual({ deltaText: "+0.2", rangeText: "0.1 → 0.3" });
    expect(describe_(detailed(10.1, 8), 8).deltaText).toBe("-2.1");
  });

  it("for an old Reconciliation row only says what the new quantity is, with no sign", () => {
    expect(describe_("ปรับปรุง lot/exp/qty (Reconciliation)", 8)).toEqual({ deltaText: null, rangeText: "ยอดใหม่ 8" });
    expect(describe_("ปรับปรุงยอดสต๊อก (Reconciliation)", 8)).toEqual({ deltaText: null, rangeText: "ยอดใหม่ 8" });
  });

  it("for the (Adjustment) rows, whose number is not known to be a new quantity, shows just the number", () => {
    expect(describe_("ปรับปรุงยอด (Adjustment)", 5)).toEqual({ deltaText: null, rangeText: "5" });
  });
});
