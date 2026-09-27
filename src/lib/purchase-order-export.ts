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
  issuer_name?: string | null;
  issuer_department?: string | null;
  issuer_department_en?: string | null;
  issuer_address?: string | null;
  issuer_phone?: string | null;
  issuer_email?: string | null;
  issuer_logo_url?: string | null;
  vendor_contact_person?: string | null;
  vendor_phone?: string | null;
  vendor_email?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  acknowledged_by?: string | null;
  acknowledged_by_name?: string | null;
  acknowledged_at?: string | null;
};

type PurchaseOrderExportOptions = {
  includeLabNote?: boolean;
};

type PurchaseOrderPrintOptions = PurchaseOrderExportOptions & {
  printWindow?: Window | null;
  now?: Date;
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("th-TH");
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatThaiDate(value?: string | null) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }) : "-";
}

function formatThaiDateTime(value?: string | null) {
  const date = parseDate(value);
  if (!date) return null;
  const time = date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
  return `${formatThaiDate(value)} · ${time} น.`;
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
  CANCELLED: "ยกเลิกแล้ว",
  CLOSED_SHORT: "ปิดใบ (ได้รับไม่ครบ)",
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

const PRINT_STYLES = `
@page { size: A4; margin: 12mm 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Barlow","Noto Sans Thai",Tahoma,sans-serif; color: #1d1f20; font-size: 12px; line-height: 1.5; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { display: flex; flex-direction: column; gap: 14px; min-height: calc(297mm - 24mm); }
.mono { font-family: "IBM Plex Mono", Consolas, monospace; }
.muted { color: #5d5d60; }
header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding-bottom: 12px; border-bottom: 3px solid #2c455d; }
.brand { display: flex; gap: 14px; align-items: center; }
.logo { width: 56px; height: 56px; border: 1px solid #b7b7ba; object-fit: contain; }
.dept { font-size: 20px; font-weight: 700; line-height: 1.25; color: #2c455d; }
.dept-en { font-size: 11px; color: #416180; letter-spacing: .04em; font-weight: 600; }
.org { font-size: 12px; font-weight: 500; }
.contact { font-size: 10px; color: #5d5d60; }
.title { display: flex; flex-direction: column; align-items: flex-end; }
.title-en { font-family: "Barlow Condensed", sans-serif; font-size: 34px; font-weight: 700; line-height: 1; letter-spacing: .02em; color: #2c455d; }
.title-th { font-size: 15px; font-weight: 700; }
.draft { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border: 1.5px dashed #b45309; color: #9a3412; font-weight: 700; }
.draft b { font-family: "Barlow Condensed", sans-serif; font-size: 15px; letter-spacing: .08em; }
.meta { display: grid; grid-template-columns: 1.3fr 1fr; border: 1px solid #b7b7ba; }
.kv { display: grid; }
.kv.left { grid-template-columns: 118px minmax(0,1fr); border-right: 1px solid #b7b7ba; }
.kv.right { grid-template-columns: 104px minmax(0,1fr); }
.kv > div { padding: 6px 10px; border-bottom: 1px solid #d4d4d7; display: flex; flex-direction: column; justify-content: center; }
.kv > div:nth-last-child(-n+2) { border-bottom: 0; }
.k { background: #eef6ff; font-size: 10px; color: #2c455d; font-weight: 600; }
.vendor-name { font-size: 13px; font-weight: 700; }
.po-no { font-size: 13px; font-weight: 500; }
.status { font-weight: 600; color: #416180; }
table { width: 100%; border-collapse: collapse; border: 1px solid #b7b7ba; }
thead tr { background: #2c455d; color: #fff; font-size: 10px; text-align: left; }
th { padding: 6px 8px; font-weight: 600; }
td { padding: 7px 8px; vertical-align: top; }
tbody tr + tr, tbody tr.item { border-top: 1px solid #d4d4d7; }
tbody td:not(:last-child) { border-right: 1px solid #d4d4d7; }
tr.cat td { background: #eef6ff; padding: 5px 8px; font-weight: 700; color: #2c455d; border-top: 1px solid #b7b7ba; border-right: 0; }
tr.cat span { font-weight: 400; color: #5d5d60; font-size: 10px; }
tr { break-inside: avoid; }
.c { text-align: center; } .r { text-align: right; }
.name { font-weight: 600; } .code { font-size: 10px; color: #5d5d60; }
.qty { font-weight: 700; }
tfoot tr { border-top: 2px solid #2c455d; }
.notes { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); border: 1px solid #b7b7ba; }
.notes.single { grid-template-columns: minmax(0,1fr); }
.notes > div { padding: 8px 10px; min-height: 64px; white-space: pre-wrap; }
.notes > div + div { border-left: 1px solid #b7b7ba; }
.label { font-size: 10px; font-weight: 600; color: #2c455d; white-space: normal; }
.spacer { flex: 1; }
.signers { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); border: 1px solid #b7b7ba; break-inside: avoid; }
.signer + .signer { border-left: 1px solid #d4d4d7; }
.signer .k { padding: 5px 8px; }
.signer .v { padding: 8px; display: flex; flex-direction: column; gap: 4px; font-size: 10px; color: #5d5d60; }
.signer .v b { color: #1d1f20; }
footer { display: flex; justify-content: space-between; font-size: 9px; color: #5d5d60; }
`;

const FONT_URL = "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@700&family=Noto+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";

function joinPresent(values: Array<string | null | undefined>, separator: string) {
  return values.map((value) => value?.trim()).filter(Boolean).join(separator);
}

function signerCell(title: string, name?: string | null, signedAt?: string | null) {
  const when = formatThaiDateTime(signedAt);
  const body = name?.trim()
    ? `<span>ชื่อ ( <b>${escapeHtml(name)}</b> )</span><span>วันที่ ${when ? `<b>${escapeHtml(when)}</b>` : "......./......./......."}</span>`
    : "<span>ชื่อ ( ........................................ )</span><span>วันที่ ......./......./.......</span>";
  return `<div class="signer"><div class="k">${escapeHtml(title)}</div><div class="v">${body}</div></div>`;
}

export function buildPurchaseOrderPrintHtml(po: PurchaseOrderForExport, options: PurchaseOrderPrintOptions = {}) {
  const isInternalDraft = po.status === "PENDING_MANAGER_REVIEW";
  const groups = groupItems(po.items);
  const itemCount = groups.reduce((total, [, items]) => total + items.length, 0);
  const requesterName = po.created_by_name || po.created_by;
  const approved = po.status !== "PENDING_MANAGER_REVIEW" && po.status !== "REJECTED";
  const approverName = approved ? po.reviewed_by_name || po.reviewed_by : null;
  const acknowledgerName = po.acknowledged_by_name || po.acknowledged_by;
  const heading = po.issuer_department || po.issuer_name || "ห้องปฏิบัติการ";
  const organization = po.issuer_department ? po.issuer_name : null;
  const issuerContact = joinPresent([po.issuer_address, po.issuer_phone && `โทร ${po.issuer_phone}`, po.issuer_email], " · ");
  const vendorContact = joinPresent([po.vendor_contact_person, po.vendor_phone && `โทร ${po.vendor_phone}`], " · ");

  const itemSections = groups.map(([category, items]) => `
      <tbody>
        <tr class="cat"><td colspan="6">${escapeHtml(category)} <span>· ${items.length} รายการ</span></td></tr>${items.map((item, index) => `
        <tr class="item"><td class="c">${index + 1}</td><td><div class="name">${escapeHtml(item.item_name ?? "-")}</div><div class="code mono">${escapeHtml(item.item_id ?? "-")}</div></td><td>${escapeHtml(item.job_type || "—")}</td><td>${escapeHtml(item.machine_type || "—")}</td><td class="r qty">${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.unit ?? "-")}</td></tr>`).join("")}
      </tbody>`).join("");

  const notes = [
    ...(options.includeLabNote ? [`<div><div class="label">หมายเหตุ Lab / Lab note</div>${escapeHtml(po.note?.trim() || "-")}</div>`] : []),
    `<div><div class="label">หมายเหตุ Vendor / Vendor note</div>${escapeHtml(po.vendor_note?.trim() || "-")}</div>`,
  ];

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>ใบสั่งของ ${escapeHtml(po.po_number)}</title>
<link href="${FONT_URL}" rel="stylesheet">
<style>${PRINT_STYLES}</style>
</head>
<body>
<div class="sheet">
  <header>
    <div class="brand">
      ${po.issuer_logo_url ? `<img class="logo" alt="" src="${escapeHtml(po.issuer_logo_url)}">` : ""}
      <div>
        <div class="dept">${escapeHtml(heading)}</div>
        ${po.issuer_department_en ? `<div class="dept-en">${escapeHtml(po.issuer_department_en)}</div>` : ""}
        ${organization ? `<div class="org">${escapeHtml(organization)}</div>` : ""}
        ${issuerContact ? `<div class="contact">${escapeHtml(issuerContact)}</div>` : ""}
      </div>
    </div>
    <div class="title">
      <div class="title-en">PURCHASE ORDER</div>
      <div class="title-th">ใบสั่งของน้ำยาและวัสดุห้องปฏิบัติการ</div>
    </div>
  </header>
  ${isInternalDraft ? '<div class="draft"><b>DRAFT</b><span>ฉบับร่างสำหรับตรวจสอบภายใน – ยังไม่ส่งให้บริษัท</span></div>' : ""}
  <section class="meta">
    <div class="kv left">
      <div class="k">ผู้ขาย<br>Vendor</div><div><span class="vendor-name">${escapeHtml(po.vendor || "-")}</span>${po.vendor_email ? `<span class="muted">${escapeHtml(po.vendor_email)}</span>` : ""}</div>
      <div class="k">ผู้ติดต่อ<br>Contact</div><div>${escapeHtml(vendorContact || "-")}</div>
      <div class="k">ผู้ขอซื้อ<br>Requested by</div><div><b>${escapeHtml(requesterName || "-")}</b>${po.issuer_department ? `<span class="muted">${escapeHtml(po.issuer_department)}</span>` : ""}</div>
    </div>
    <div class="kv right">
      <div class="k">เลขที่<br>PO No.</div><div class="mono po-no">${escapeHtml(po.po_number)}</div>
      <div class="k">วันที่<br>Date</div><div>${escapeHtml(formatThaiDate(po.created_at))}</div>
      <div class="k">ต้องการรับ<br>Required</div><div>${escapeHtml(formatThaiDate(po.expected_date))}</div>
      <div class="k">สถานะ<br>Status</div><div class="status">${escapeHtml(formatStatus(po.status))}</div>
    </div>
  </section>
  <table>
    <thead>
      <tr>
        <th class="c" style="width:40px">No.</th>
        <th>รหัส / รายการ<br>Code / Description</th>
        <th style="width:90px">งานตรวจ<br>Test</th>
        <th style="width:90px">เครื่องตรวจ<br>Analyzer</th>
        <th class="r" style="width:54px">จำนวน<br>Qty</th>
        <th style="width:52px">หน่วย<br>Unit</th>
      </tr>
    </thead>${itemSections || '\n      <tbody><tr><td colspan="6" class="c muted">ไม่มีรายการ</td></tr></tbody>'}
    <tfoot>
      <tr><td colspan="4" class="r muted">รวมทั้งสิ้น / Total</td><td colspan="2" class="qty">${itemCount} รายการ</td></tr>
    </tfoot>
  </table>
  <section class="notes${notes.length === 1 ? " single" : ""}">
    ${notes.join("\n    ")}
  </section>
  <div class="spacer"></div>
  <section class="signers">
    ${signerCell("ผู้ขอซื้อ / Requested by", requesterName, po.created_at)}
    ${signerCell("ผู้อนุมัติ / Approved by", approverName, po.reviewed_at)}
    ${signerCell("บริษัทรับทราบ / Vendor acknowledged", acknowledgerName, po.acknowledged_at)}
  </section>
  <footer>
    <span>สร้างจาก LabStock เมื่อ ${escapeHtml((options.now ?? new Date()).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }))}</span>
    <span class="mono">${escapeHtml(po.po_number)}</span>
  </footer>
</div>
<script>window.onload = () => { (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { window.focus(); window.print(); }); };</script>
</body>
</html>`;
}

export function openPurchaseOrderPrintWindow() {
  const printWindow = window.open("", "_blank", "width=960,height=720");
  if (!printWindow) {
    throw new Error("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต popup แล้วลองใหม่");
  }
  return printWindow;
}

export function printPurchaseOrderPdf(po: PurchaseOrderForExport, options: PurchaseOrderPrintOptions = {}) {
  const printWindow = options.printWindow ?? openPurchaseOrderPrintWindow();
  printWindow.document.open();
  printWindow.document.write(buildPurchaseOrderPrintHtml(po, options));
  printWindow.document.close();
}
