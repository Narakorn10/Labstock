import { describe, expect, it } from "vitest";
import { buildPurchaseOrderCsv, buildPurchaseOrderPrintHtml } from "./purchase-order-export";

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

describe("buildPurchaseOrderPrintHtml", () => {
  const basePo = {
    po_number: "PO-20260927-001",
    vendor: "PCL",
    status: "SUBMITTED",
    created_at: "2026-09-27T02:14:00.000Z",
    expected_date: "2026-10-04",
    issuer_name: "โรงพยาบาลสวรรค์ประชารักษ์",
    issuer_department: "ห้องปฏิบัติการเคมีคลินิก",
    created_by: "somchai",
    created_by_name: "สมชาย ใจดี",
    items: [
      { item_id: "CHEM-R-001", item_name: "Glucose", quantity: 10, unit: "box", reagent_type: "น้ำยาตรวจ" },
      { item_id: "CHEM-R-002", item_name: "BUN", quantity: 6, unit: "box", reagent_type: "น้ำยาตรวจ" },
      { item_id: "QC-1", item_name: "Control", quantity: 1, unit: "set", reagent_type: "QC" },
    ],
  };

  it("uses the PO's issuing department as the letterhead and groups items by category", () => {
    const html = buildPurchaseOrderPrintHtml(basePo);

    expect(html).toContain('<div class="dept">ห้องปฏิบัติการเคมีคลินิก</div>');
    expect(html).toContain('<div class="org">โรงพยาบาลสวรรค์ประชารักษ์</div>');
    expect(html).toContain("QC <span>· 1 รายการ</span>");
    expect(html).toContain("น้ำยาตรวจ <span>· 2 รายการ</span>");
    expect(html).toContain('<td colspan="2" class="qty">3 รายการ</td>');
    expect(html).not.toMatch(/ราคา|price/i);
  });

  it("shows signer names and Buddhist-era dates when signed, dotted lines when not", () => {
    const html = buildPurchaseOrderPrintHtml({
      ...basePo,
      reviewed_by: "boss",
      reviewed_by_name: "หัวหน้า ห้องแล็บ",
      reviewed_at: "2026-09-27T03:00:00.000Z",
    });

    expect(html).toContain("ชื่อ ( <b>สมชาย ใจดี</b> )");
    expect(html).toContain("ชื่อ ( <b>หัวหน้า ห้องแล็บ</b> )");
    expect(html).toMatch(/27 ก\.ย\. 2569 · 09:14 น\./);
    expect(html.match(/ชื่อ \( \.+ \)/g)).toHaveLength(1);
  });

  it("does not show a rejecting reviewer as the approver", () => {
    const html = buildPurchaseOrderPrintHtml({ ...basePo, status: "REJECTED", reviewed_by: "boss", reviewed_by_name: "หัวหน้า" });

    expect(html).not.toContain("<b>หัวหน้า</b>");
  });

  it("shows the draft banner only while waiting for manager review", () => {
    expect(buildPurchaseOrderPrintHtml({ ...basePo, status: "PENDING_MANAGER_REVIEW" })).toContain('<div class="draft">');
    expect(buildPurchaseOrderPrintHtml(basePo)).not.toContain('<div class="draft">');
  });

  it("escapes every value and keeps the Lab note out unless requested", () => {
    const html = buildPurchaseOrderPrintHtml({
      ...basePo,
      vendor: "<script>alert(1)</script>",
      issuer_department: '"><img src=x onerror=alert(1)>',
      note: "internal only",
      items: [{ item_id: "<b>", item_name: "A & B", quantity: 1, unit: "<u>" }],
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).not.toContain("internal only");
    expect(buildPurchaseOrderPrintHtml({ ...basePo, note: "internal only" }, { includeLabNote: true })).toContain("internal only");
  });
});
