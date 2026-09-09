import { describe, expect, it } from "vitest";
import { buildPurchaseOrderCsv } from "./purchase-order-export";

describe("buildPurchaseOrderCsv", () => {
  it("creates a UTF-8 BOM CSV with Thai labels and escaped values", () => {
    const csv = buildPurchaseOrderCsv({
      po_number: "PO-2026-001",
      vendor: "บริษัท, ทดสอบ",
      status: "SUBMITTED",
      created_at: "2026-08-11T00:00:00.000Z",
      note: "ต้องการ \"ด่วน\"",
      items: [{ item_id: "R-1", item_name: "น้ำยา, A", quantity: 3, unit: "กล่อง" }],
    }, { includeLabNote: true });

    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"บริษัท, ทดสอบ"');
    expect(csv).toContain('"ต้องการ ""ด่วน"""');
    expect(csv).toContain('"ส่งให้บริษัทแล้ว"');
    expect(csv).toContain('"น้ำยา, A"');
    expect(csv).toContain("\r\n");
  });

  it("keeps Lab notes out of Vendor exports and neutralizes formulas", () => {
    const csv = buildPurchaseOrderCsv({
      po_number: "PO-2026-002",
      vendor: "=unsafe",
      status: "CONFIRMED",
      note: "internal only",
      items: [{ item_id: "+R-2", item_name: "Reagent", quantity: 1, unit: "กล่อง" }],
    });

    expect(csv).not.toContain("internal only");
    expect(csv).toContain("'=unsafe");
    expect(csv).toContain("'+R-2");
  });

  it("groups exported items by reagent category and includes workflow columns", () => {
    const csv = buildPurchaseOrderCsv({
      po_number: "PO-2026-003",
      status: "SUBMITTED",
      items: [
        {
          item_id: "R-3",
          item_name: "Reagent C",
          reagent_type: "เคมีคลินิก",
          job_type: "Glucose",
          machine_type: "Analyzer A",
          quantity: 2,
          unit: "กล่อง",
        },
      ],
    });

    expect(csv).toContain('"หมวดหมู่"');
    expect(csv).toContain('"เคมีคลินิก"');
    expect(csv).toContain('"Glucose"');
    expect(csv).toContain('"Analyzer A"');
  });
});
