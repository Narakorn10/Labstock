import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PoAddItemsDialog } from "@/components/po-add-items-dialog";
import { buildAddItemsBody, canSubmitLines, isLineComplete, type NewLine } from "./po-add-items-client";

const line = (over: Partial<NewLine> = {}): NewLine => ({ item_id: "LAB-000001", item_name: "Reagent 1", unit: "box", quantity: "3", reason: "ขาดช่วงใช้งาน", ...over });

describe("add-items lines", () => {
  it("a line needs a whole quantity of at least 1 and a reason", () => {
    expect(isLineComplete(line())).toBe(true);
    for (const quantity of ["", "0", "-2", "1.5", "abc", "1e3", " ", "1234567890"]) expect(isLineComplete(line({ quantity })), quantity).toBe(false);
    expect(isLineComplete(line({ reason: "   " }))).toBe(false);
  });

  it("cannot be submitted when empty, incomplete or repeated", () => {
    expect(canSubmitLines([])).toBe(false);
    expect(canSubmitLines([line(), line({ item_id: "X-LEGACY", reason: "" })])).toBe(false);
    expect(canSubmitLines([line(), line()])).toBe(false);
    expect(canSubmitLines([line(), line({ item_id: "X-LEGACY" })])).toBe(true);
  });

  it("builds the request: the add action, numeric quantity, MANUAL basis and the trimmed reason", () => {
    expect(buildAddItemsBody([line({ quantity: " 4 ", reason: "  เหตุผล  " })])).toEqual({
      action: "ADD_ITEMS_TO_MANAGER_REVIEW",
      items: [{ item_id: "LAB-000001", item_name: "Reagent 1", unit: "box", quantity: 4, selected_basis: "MANUAL", override_reason: "เหตุผล" }],
    });
  });
});

describe("PoAddItemsDialog first render", () => {
  it("names the company, says existing lines stay untouched, and starts with nothing to submit", () => {
    const out = renderToStaticMarkup(
      <PoAddItemsDialog poId={1} vendor="Vendor A" existingItemIds={["A-000002"]} getAuthHeaders={() => ({})} onAdded={() => undefined} onClose={() => undefined} />,
    );
    expect(out).toContain("เพิ่มรายการน้ำยา");
    expect(out).toContain("Vendor A");
    expect(out).toContain("รายการเดิมไม่ถูกแก้ไขหรือลบ");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>เพิ่ม\s*รายการเข้าใบนี้<\/button>/);
  });
});
