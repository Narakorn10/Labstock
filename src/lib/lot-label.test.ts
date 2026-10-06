import { describe, expect, it } from "vitest";
import type { BarcodePattern, BarcodePatternV2Runtime } from "./api-client";
import { findMatchingReagent, findMatchingReagentWithV2, processAnyBarcode } from "./barcode-parser";
import { buildLotLabelPayload, parseLotLabelPayload } from "./lot-label";

const reagents = [
  { itemId: "R-001", qrCode: "08851234567890" },
  { itemId: "R-0011", qrCode: "" },
  { itemId: "LS1", qrCode: "" },
];

// A broad vendor pattern whose item group would grab "R-0011" if it were applied to our label.
const greedy: BarcodePattern = {
  id: 9,
  name: "greedy",
  regex_pattern: "(R-0011|R-001)",
  item_id_group: 1,
  lot_no_group: 1,
  exp_date_group: 1,
};

describe("lot label payload", () => {
  it.each([
    { itemId: "R-001", lotNo: "L1", expDate: "2027-01-31" },
    { itemId: "R 01/A", lotNo: "LOT|7 / B", expDate: "2027-01-31" },
    { itemId: "R-001", lotNo: "ล็อต-1", expDate: "" },
  ])("round-trips %o", (label) => {
    expect(parseLotLabelPayload(buildLotLabelPayload(label))).toEqual(label);
  });

  it("drops a non-ISO expiry instead of printing garbage", () => {
    expect(buildLotLabelPayload({ itemId: "R-001", lotNo: "L1", expDate: "NEED_MANUAL_INPUT" })).toBe("LS1|R-001|L1|");
  });

  it.each(["", "R-001", "LS1|R-001|L1", "LS1||L1|", "LS1|R-001|L1|31/01/2027", "XX1|R-001|L1|2027-01-31", "LS1|%E0|L1|"])(
    "rejects %s",
    (raw) => expect(parseLotLabelPayload(raw)).toBeNull(),
  );
});

describe("scanning a lot label", () => {
  const raw = buildLotLabelPayload({ itemId: "R-001", lotNo: "L1", expDate: "2027-01-31" });

  it("is parsed with lot and expiry", () => {
    expect(processAnyBarcode(raw, [greedy])).toMatchObject({
      barcodeType: "INTERNAL_LOT",
      gtin: "R-001",
      lot: "L1",
      expDate: "2027-01-31",
    });
  });

  it("matches only the exact item, even when a vendor pattern would pick another one", () => {
    const result = findMatchingReagent(raw, [greedy], reagents);
    expect(result.match?.itemId).toBe("R-001");
    expect(result.data?.lot).toBe("L1");
  });

  it("finds nothing for an unknown item instead of guessing", () => {
    const unknown = buildLotLabelPayload({ itemId: "R-00", lotNo: "L1", expDate: "" });
    const result = findMatchingReagent(unknown, [greedy], reagents);
    expect(result.match).toBeUndefined();
    expect(result.data?.expDate).toBe("NEED_MANUAL_INPUT");
  });

  it("never falls through to learned V2 patterns", () => {
    const v2: BarcodePatternV2Runtime = {
      id: 2, name: "catch-all", mapping_mode: "FIXED_REAGENT", fixed_item_id: "R-0011",
      regex_pattern: "^(.*)$", item_id_group: null, lot_no_group: 1, exp_date_group: null,
    };
    const unknown = buildLotLabelPayload({ itemId: "GONE", lotNo: "L1", expDate: "" });
    const result = findMatchingReagentWithV2(unknown, [], [v2], reagents, true);
    expect(result.match).toBeUndefined();
    expect(result.v2Match).toBeUndefined();
  });

  it("leaves GS1 and plain barcodes unchanged", () => {
    expect(processAnyBarcode("(01)08851234567890(17)270131(10)L9")?.barcodeType).toBe("GS1_COMPLIANT");
    expect(findMatchingReagent("(01)08851234567890(17)270131(10)L9", [], reagents).match?.itemId).toBe("R-001");
    expect(processAnyBarcode("R-001")?.barcodeType).toBe("STANDARD_1D");
  });
});
