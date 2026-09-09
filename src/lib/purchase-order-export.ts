export type PurchaseOrderExportItem = {
  item_id?: string | null;
  item_name?: string | null;
  quantity: number;
  unit?: string | null;
  reagent_type?: string | null;
  job_type?: string | null;
  machine_type?: string | null;
};

export type PurchaseOrderForExport = {
  po_number: string;
  vendor?: string | null;
  status: string;
  created_at?: string | null;
  expected_date?: string | null;
  note?: string | null;
  vendor_note?: string | null;
  items?: PurchaseOrderExportItem[];
};

type PurchaseOrderExportOptions = {
  includeLabNote?: boolean;
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("th-TH");
}

const statusLabels: Record<string, string> = {
  PENDING_MANAGER_REVIEW: "รอหัวหน้าตรวจสอบ",
  PENDING_LAB_REVIEW: "รอ Lab ตรวจสอบ",
  SUBMITTED: "ส่งให้บริษัทแล้ว",
  ACKNOWLEDGED: "บริษัทรับทราบแล้ว",
  REVISION_REQUESTED: "รอ Lab ตรวจสอบฉบับแก้ไข",
  CONFIRMED: "ยืนยันแล้ว",
  PARTIALLY_SHIPPED: "จัดส่งบางส่วน",
  SHIPPED: "จัดส่งแล้ว",
  PARTIALLY_RECEIVED: "รับเข้าแล้วบางส่วน",
  RECEIVED: "รับเข้าแล้ว",
  REJECTED: "ปฏิเสธ",
  EXPIRED: "หมดอายุ",
};

function formatStatus(status: string) {
  return statusLabels[status] ?? status;
}

function csvValue(value: unknown) {
  const rawText = String(value ?? "");
  const text = /^[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "purchase-order";
}

function groupItems(items: PurchaseOrderExportItem[] = []) {
  const groups = new Map<string, PurchaseOrderExportItem[]>();
  for (const item of items) {
    const category = item.reagent_type?.trim() || "ไม่ระบุหมวดหมู่";
    groups.set(category, [...(groups.get(category) ?? []), item]);
  }

  return [...groups.entries()].sort(([left], [right]) => {
    if (left === "ไม่ระบุหมวดหมู่") return 1;
    if (right === "ไม่ระบุหมวดหมู่") return -1;
    return left.localeCompare(right, "th");
  });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportRows(po: PurchaseOrderForExport, options: PurchaseOrderExportOptions) {
  const isInternalDraft = po.status === "PENDING_MANAGER_REVIEW";
  const itemRows = groupItems(po.items).flatMap(([category, items]) => items.map((item, index) => [
    category,
    index + 1,
    item.item_id ?? "-",
    item.item_name ?? "-",
    item.job_type ?? "-",
    item.machine_type ?? "-",
    Number(item.quantity),
    item.unit ?? "-",
  ]));

  return [
    [isInternalDraft ? "ใบสั่งซื้อน้ำยา (ฉบับร่าง - รอตรวจสอบภายใน)" : "ใบสั่งซื้อน้ำยา", po.po_number],
    ["บริษัท", po.vendor ?? "-"],
    ["สถานะ", formatStatus(po.status)],
    ["วันที่สร้าง", formatDate(po.created_at)],
    ["วันที่คาดว่าจะส่ง", formatDate(po.expected_date)],
    ...(options.includeLabNote ? [["หมายเหตุ Lab", po.note ?? "-"]] : []),
    ["หมายเหตุ Vendor", po.vendor_note ?? "-"],
    [],
    ["หมวดหมู่", "ลำดับ", "รหัสน้ำยา", "รายการน้ำยา", "งานตรวจ", "เครื่องตรวจ", "จำนวน", "หน่วย"],
    ...itemRows,
  ];
}

export function buildPurchaseOrderCsv(po: PurchaseOrderForExport, options: PurchaseOrderExportOptions = {}) {
  return `\ufeff${exportRows(po, options).map((row) => row.map(csvValue).join(",")).join("\r\n")}`;
}

export function exportPurchaseOrderCsv(po: PurchaseOrderForExport, options: PurchaseOrderExportOptions = {}) {
  const content = buildPurchaseOrderCsv(po, options);
  download(new Blob([content], { type: "text/csv;charset=utf-8" }), `${safeFileName(po.po_number)}.csv`);
}

export function printPurchaseOrderPdf(po: PurchaseOrderForExport, options: PurchaseOrderExportOptions = {}) {
  const printWindow = window.open("", "_blank", "width=960,height=720");
  if (!printWindow) {
    throw new Error("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต popup แล้วลองใหม่");
  }

  const categorySections = groupItems(po.items).map(([category, items]) => `
    <section class="category">
      <h2>${escapeHtml(category)} <span>${items.length} รายการ</span></h2>
      <table>
        <thead><tr><th>ลำดับ</th><th>รหัส / รายการน้ำยา</th><th>งานตรวจ</th><th>เครื่องตรวจ</th><th>จำนวน</th><th>หน่วย</th></tr></thead>
        <tbody>${items.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td><strong>${escapeHtml(item.item_name ?? "-")}</strong><br /><small>${escapeHtml(item.item_id ?? "-")}</small></td>
            <td>${escapeHtml(item.job_type ?? "-")}</td>
            <td>${escapeHtml(item.machine_type ?? "-")}</td>
            <td class="number">${escapeHtml(item.quantity)}</td>
            <td>${escapeHtml(item.unit ?? "-")}</td>
          </tr>`).join("")}</tbody>
      </table>
    </section>`).join("");
  const isInternalDraft = po.status === "PENDING_MANAGER_REVIEW";

  printWindow.document.write(`<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <title>ใบสั่งซื้อ ${escapeHtml(po.po_number)}</title>
    <style>
      @page { size: A4; margin: 16mm; }
      body { font-family: "Noto Sans Thai", "Tahoma", sans-serif; color: #172033; font-size: 12px; }
      h1 { margin: 0 0 4px; font-size: 22px; }
      .muted { color: #64748b; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; margin: 20px 0; }
      .meta strong { display: block; color: #475569; font-size: 10px; }
      .note { margin: 12px 0; padding: 10px 12px; background: #f8fafc; border-left: 3px solid #4f46e5; white-space: pre-wrap; }
      .draft { margin: 16px 0; padding: 10px 12px; background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; font-weight: 700; }
      table { border-collapse: collapse; width: 100%; margin-top: 18px; }
      th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #eef2ff; color: #312e81; font-size: 11px; }
      h2 { margin: 18px 0 0; padding-bottom: 6px; border-bottom: 2px solid #172033; font-size: 14px; }
      h2 span { color: #64748b; font-size: 10px; font-weight: 400; }
      small { color: #64748b; }
      .category { break-inside: avoid; }
      .number { text-align: right; }
      footer { margin-top: 28px; color: #64748b; font-size: 10px; }
    </style>
  </head>
  <body>
    <h1>ใบสั่งซื้อน้ำยา</h1>
    <div class="muted">PO No. ${escapeHtml(po.po_number)}</div>
    ${isInternalDraft ? '<div class="draft">ฉบับร่างสำหรับตรวจสอบภายใน - ยังไม่ส่งให้บริษัท</div>' : ""}
    <section class="meta">
      <div><strong>บริษัท</strong>${escapeHtml(po.vendor ?? "-")}</div>
      <div><strong>สถานะ</strong>${escapeHtml(formatStatus(po.status))}</div>
      <div><strong>วันที่สร้าง</strong>${escapeHtml(formatDate(po.created_at))}</div>
      <div><strong>วันที่คาดว่าจะส่ง</strong>${escapeHtml(formatDate(po.expected_date))}</div>
    </section>
    ${options.includeLabNote && po.note ? `<section class="note"><strong>หมายเหตุ Lab</strong><br />${escapeHtml(po.note)}</section>` : ""}
    ${po.vendor_note ? `<section class="note"><strong>หมายเหตุ Vendor</strong><br />${escapeHtml(po.vendor_note)}</section>` : ""}
    ${categorySections || '<p>ไม่มีรายการน้ำยา</p>'}
    <footer>สร้างเอกสารเมื่อ ${escapeHtml(new Date().toLocaleString("th-TH"))}</footer>
    <script>window.onload = () => { window.focus(); window.print(); };</script>
  </body>
</html>`);
  printWindow.document.close();
}
