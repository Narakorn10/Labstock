export interface PurchaseOrder {
  id?: number;
  po_number: string;
  vendor: string;
  status: string;
  expected_date?: string | null;
  items?: Array<{
    item_name: string;
    quantity: number;
    unit: string;
  }>;
}

export interface TrackingResult {
  provider: string;
  trackingNo: string;
  status: string;
  statusText: string;
  lastUpdate: string;
  history?: Array<{
    timestamp: string;
    status: string;
    location: string;
    description: string;
  }>;
}

export interface LowStockItem {
  itemId: string;
  name: string;
  quantity: number;
  minThreshold: number;
  unit: string;
  vendor?: string;
}

export interface ExpiringSoonItem {
  itemId: string;
  name: string;
  lotNo: string;
  expDate: string;
  quantity: number;
  unit: string;
  daysUntilExpiry: number;
  vendor?: string;
}

export interface WeeklyStockSummaryItem {
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  weeklyTarget: number;
  vendor: string;
}

export interface WeeklyLowStockItem extends LowStockItem {
  jobType: string;
  vendor: string;
}

export interface WeeklyStockAlertPayload {
  lowStockItems: WeeklyLowStockItem[];
  expiringSoonItems: Array<ExpiringSoonItem & { jobType: string; vendor: string }>;
  orderUrl?: string;
}

// Flex messages only accept #RRGGBB, so the design's oklch tokens are converted once here.
// green = oklch(0.45 0.13 150), crit = oklch(0.55 0.19 27), warn = oklch(0.56 0.12 65), warnBg = oklch(0.955 0.055 85).
const COLOR = {
  ink: "#1D1F20",
  inkMuted: "#6B6E72",
  inkSoft: "#B8BBBF",
  green: "#00682A",
  crit: "#C9302D",
  warn: "#A46311",
  warnBg: "#FFEEC7",
  white: "#FFFFFF",
} as const;

const appUrl = (path: string) => `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}${path}`;

const PO_STATUS_LABELS: Record<string, string> = {
  PENDING_MANAGER_REVIEW: "รอหัวหน้าตรวจ",
  SUBMITTED: "ส่งให้ Vendor แล้ว",
  ACKNOWLEDGED: "Vendor รับทราบ",
  PENDING_LAB_REVIEW: "รอ Lab ตรวจ",
  REVISION_REQUESTED: "Vendor ขอแก้ไข",
  CONFIRMED: "Vendor ยืนยัน",
  PARTIALLY_SHIPPED: "จัดส่งบางส่วน",
  SHIPPED: "จัดส่งแล้ว",
  PARTIALLY_RECEIVED: "รับสินค้าบางส่วน",
  RECEIVED: "รับสินค้าครบแล้ว",
  REJECTED: "ปฏิเสธ",
  CANCELLED: "ยกเลิกแล้ว",
  CLOSED_SHORT: "ปิดใบ (ได้รับไม่ครบ)",
};

/** Statuses where somebody still has to act, drawn in the amber tone. */
const PO_ATTENTION_STATUSES = new Set(["PENDING_MANAGER_REVIEW", "PENDING_LAB_REVIEW", "REVISION_REQUESTED", "REJECTED", "CANCELLED"]);

/** Thai label for a PO status; unknown statuses are shown as-is. */
export function poStatusLabel(status: string) {
  return PO_STATUS_LABELS[status] ?? status;
}

const chunk = <T,>(items: T[], size: number) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, (index + 1) * size),
);

/** Dark header: small grey eyebrow, then the title (and an optional subtitle). */
function darkHeader(eyebrow: string, title: string, subtitle?: string) {
  const contents: Array<Record<string, unknown>> = [
    { type: "text", text: eyebrow, color: COLOR.inkSoft, size: "xxs", weight: "bold" },
    { type: "text", text: title, color: COLOR.white, size: "lg", weight: "bold", margin: "sm", wrap: true },
  ];
  if (subtitle) contents.push({ type: "text", text: subtitle, color: COLOR.inkSoft, size: "xs", margin: "sm", wrap: true });

  return { type: "box", layout: "vertical", backgroundColor: COLOR.ink, paddingAll: "16px", contents };
}

function pill(text: string, tone: "ok" | "warn" | "neutral") {
  const style = tone === "warn"
    ? { background: COLOR.warnBg, color: COLOR.warn }
    : tone === "ok"
      ? { background: "#DCF9E1", color: "#21763C" }
      : { background: "#F0F0F2", color: COLOR.ink };

  return {
    type: "box",
    layout: "vertical",
    flex: 0,
    backgroundColor: style.background,
    cornerRadius: "20px",
    paddingTop: "3px",
    paddingBottom: "3px",
    paddingStart: "10px",
    paddingEnd: "10px",
    contents: [{ type: "text", text, size: "xs", weight: "bold", color: style.color }],
  };
}

function labelRow(label: string, value: string, valueColor: string = COLOR.ink) {
  return {
    type: "box",
    layout: "horizontal",
    margin: "md",
    contents: [
      { type: "text", text: label, size: "sm", color: COLOR.inkMuted, flex: 3, wrap: true },
      { type: "text", text: value, size: "sm", weight: "bold", color: valueColor, align: "end", flex: 2, wrap: true },
    ],
  };
}

function weeklyAlertBubble(title: string, subtitle: string, rows: Array<Record<string, unknown>>) {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      header: darkHeader("สรุปสต็อกรายสัปดาห์", title, subtitle),
      body: {
        type: "box",
        layout: "vertical",
        contents: rows.length ? rows : [{ type: "text", text: "ไม่มีรายการที่ต้องดำเนินการ", size: "sm", color: COLOR.green, wrap: true }],
      },
    },
  };
}

function addWeeklyOrderFooter(bubble: Record<string, unknown>, orderUrl?: string) {
  if (!orderUrl) return bubble;

  const contents = bubble.contents as Record<string, unknown>;
  contents.footer = {
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "button",
        style: "link",
        height: "sm",
        color: COLOR.green,
        action: { type: "uri", label: "เปิด LabStock", uri: appUrl("/dashboard") },
      },
      { type: "separator" },
      {
        type: "button",
        style: "link",
        height: "sm",
        color: COLOR.green,
        action: { type: "uri", label: "สั่งน้ำยา", uri: orderUrl },
      },
    ],
  };

  return bubble;
}

export function generateWeeklyStockAlertTemplates(alerts: WeeklyStockAlertPayload) {
  const messages: Array<Record<string, unknown>> = [];
  const totalLowStock = alerts.lowStockItems.length;
  const totalExpiring = alerts.expiringSoonItems.length;
  messages.push(addWeeklyOrderFooter(weeklyAlertBubble(
    "สรุปความเสี่ยงสต็อกรายสัปดาห์",
    `สต็อกใกล้หมด ${totalLowStock} รายการ • ใกล้หมดอายุ ${totalExpiring} lot`,
    [
      labelRow("สต็อกใกล้หมด", `${totalLowStock} รายการ`, totalLowStock > 0 ? COLOR.crit : COLOR.ink),
      labelRow("ใกล้หมดอายุภายใน 30 วัน", `${totalExpiring} lot`, totalExpiring > 0 ? COLOR.warn : COLOR.ink),
      { type: "text", text: "รายละเอียดอยู่ในการ์ดถัดไป", size: "xs", color: COLOR.inkMuted, margin: "lg" },
    ],
  ), alerts.orderUrl));

  const byJob = new Map<string, WeeklyLowStockItem[]>();
  alerts.lowStockItems.forEach((item) => {
    const job = item.jobType || "ไม่ระบุงาน";
    byJob.set(job, [...(byJob.get(job) ?? []), item]);
  });
  for (const [jobType, items] of byJob) {
    const pages = chunk(items, 10);
    pages.forEach((page, pageIndex) => messages.push(weeklyAlertBubble(
      `สต็อกใกล้หมด • ${jobType}`,
      `${items.length} รายการ${pages.length > 1 ? ` • หน้า ${pageIndex + 1}/${pages.length}` : ""}`,
      page.map((item, index) => ({
        type: "box", layout: "vertical", margin: index === 0 ? "none" : "md", contents: [
          { type: "text", text: `${pageIndex * 10 + index + 1}. ${item.name}`, size: "sm", weight: "bold", wrap: true, color: COLOR.ink },
          { type: "text", text: `คงเหลือ ${item.quantity} ${item.unit} • ขั้นต่ำ ${item.minThreshold} ${item.unit}`, size: "xs", color: COLOR.crit, margin: "sm", wrap: true },
        ],
      })),
    )));
  }

  const expiryPages = chunk(alerts.expiringSoonItems, 10);
  expiryPages.forEach((page, pageIndex) => messages.push(weeklyAlertBubble(
    "น้ำยาใกล้หมดอายุ",
    `${alerts.expiringSoonItems.length} lot ภายใน 30 วัน${expiryPages.length > 1 ? ` • หน้า ${pageIndex + 1}/${expiryPages.length}` : ""}`,
    page.map((item, index) => ({
      type: "box", layout: "vertical", margin: index === 0 ? "none" : "md", contents: [
        { type: "text", text: `${pageIndex * 10 + index + 1}. ${item.name}`, size: "sm", weight: "bold", wrap: true, color: COLOR.ink },
        { type: "text", text: `งาน: ${item.jobType || "ไม่ระบุงาน"} • Lot ${item.lotNo}`, size: "xs", color: COLOR.inkMuted, margin: "sm", wrap: true },
        { type: "text", text: `หมดอายุ ${item.expDate} • เหลือ ${item.quantity} ${item.unit} • อีก ${item.daysUntilExpiry} วัน`, size: "xs", color: COLOR.warn, margin: "sm", wrap: true },
      ],
    })),
  )));

  return messages;
}

export function generatePONotificationTemplate(po: PurchaseOrder) {
  const itemComponents = po.items?.map((item) => ({
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      { type: "text", text: item.item_name || "-", size: "sm", color: COLOR.inkMuted, wrap: true, flex: 3 },
      { type: "text", text: `${item.quantity} ${item.unit}`, size: "sm", weight: "bold", color: COLOR.ink, align: "end", flex: 1 },
    ],
  })) || [];

  return {
    type: "flex",
    altText: `ใบสั่งซื้อใหม่: ${po.po_number}`,
    contents: {
      type: "bubble",
      header: darkHeader("ใบสั่งซื้อใหม่", po.po_number),
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            alignItems: "center",
            contents: [
              { type: "text", text: po.vendor || "-", weight: "bold", size: "md", wrap: true, flex: 1 },
              pill(poStatusLabel(po.status), PO_ATTENTION_STATUSES.has(po.status) ? "warn" : "neutral"),
            ],
          },
          { type: "separator", margin: "lg" },
          { type: "box", layout: "vertical", margin: "lg", contents: itemComponents },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: COLOR.green,
            action: { type: "uri", label: "เปิดเว็บดำเนินการ", uri: appUrl(`/orders/${po.id || po.po_number}`) },
          },
        ],
        flex: 0,
      },
    },
  };
}

export function generatePOStatusTemplate(po: PurchaseOrder, heading?: string) {
  const expected = po.expected_date ? new Date(po.expected_date) : null;
  const expectedText = expected && !Number.isNaN(expected.getTime()) ? expected.toLocaleDateString("th-TH") : "-";

  return {
    type: "flex",
    altText: heading ? `${heading}: ${po.po_number}` : `PO Status: ${po.po_number}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          ...(heading ? [{ type: "text", text: heading, weight: "bold", wrap: true, color: COLOR.crit, size: "sm", margin: "none" }] : []),
          {
            type: "box",
            layout: "horizontal",
            alignItems: "center",
            margin: heading ? "md" : "none",
            contents: [
              { type: "text", text: "สถานะใบสั่งซื้อ", size: "xs", color: COLOR.inkMuted, flex: 1 },
              pill(poStatusLabel(po.status), PO_ATTENTION_STATUSES.has(po.status) ? "warn" : "neutral"),
            ],
          },
          { type: "text", text: po.po_number, weight: "bold", size: "xl", margin: "md", wrap: true },
          { type: "text", text: po.vendor || "-", size: "sm", color: COLOR.inkMuted, wrap: true },
          { type: "separator", margin: "lg" },
          labelRow("กำหนดส่ง", expectedText),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: COLOR.green,
            action: { type: "uri", label: "ดูใบสั่งซื้อบนเว็บ", uri: appUrl(`/orders/${po.id || po.po_number}`) },
          },
        ],
        flex: 0,
      },
    },
  };
}

export function generateTrackingTemplate(tracking: TrackingResult) {
  const historyComponents = tracking.history?.map((event) => ({
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: new Date(event.timestamp).toLocaleTimeString(),
        size: "xs",
        color: COLOR.inkMuted,
        flex: 1
      },
      {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: event.status,
            size: "sm",
            weight: "bold",
            color: COLOR.ink
          },
          {
            type: "text",
            text: event.location,
            size: "xs",
            color: COLOR.inkMuted
          }
        ],
        flex: 3
      }
    ],
    margin: "md"
  })) || [];

  return {
    type: "flex",
    altText: `Tracking: ${tracking.trackingNo}`,
    contents: {
      type: "bubble",
      header: darkHeader(`ขนส่ง: ${tracking.provider}`, tracking.trackingNo),
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: tracking.statusText,
            weight: "bold",
            size: "md",
            wrap: true
          },
          {
            type: "separator",
            margin: "lg"
          },
          ...historyComponents
        ]
      }
    }
  };
}

export function generateLowStockTemplate(items: LowStockItem[]) {
  const carouselBubbles = items.slice(0, 10).map(item => ({
    type: "bubble",
    size: "micro",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "สต็อกใกล้หมด",
          weight: "bold",
          color: COLOR.crit,
          size: "sm"
        },
        {
          type: "text",
          text: item.name,
          weight: "bold",
          size: "lg",
          margin: "md",
          wrap: true
        },
        {
          type: "text",
          text: `คงเหลือ ${item.quantity} ${item.unit}`,
          size: "sm",
          margin: "sm"
        },
        {
          type: "text",
          text: `ขั้นต่ำ ${item.minThreshold} ${item.unit}`,
          size: "xs",
          color: COLOR.inkMuted
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: COLOR.green,
          action: {
            type: "uri",
            label: "สั่งซื้อ",
            uri: appUrl("/orders?suggest=true")
          }
        }
      ]
    }
  }));

  return {
    type: "flex",
    altText: "Low Stock Alerts",
    contents: {
      type: "carousel",
      contents: carouselBubbles
    }
  };
}

export function generateExpiringSoonTemplate(items: ExpiringSoonItem[]) {
  const carouselBubbles = items.slice(0, 10).map((item) => ({
    type: "bubble",
    size: "micro",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "ใกล้หมดอายุ",
          weight: "bold",
          color: COLOR.warn,
          size: "sm"
        },
        {
          type: "text",
          text: item.name,
          weight: "bold",
          size: "md",
          margin: "md",
          wrap: true
        },
        {
          type: "text",
          text: `Lot: ${item.lotNo}`,
          size: "xs",
          color: COLOR.inkMuted,
          margin: "sm",
          wrap: true
        },
        {
          type: "text",
          text: `หมดอายุ: ${new Date(item.expDate).toLocaleDateString("th-TH")}`,
          size: "sm",
          margin: "sm",
          wrap: true
        },
        {
          type: "text",
          text: `คงเหลือ: ${item.quantity} ${item.unit}`,
          size: "xs",
          color: COLOR.inkMuted,
          margin: "sm"
        },
        {
          type: "text",
          text: `เหลืออีก ${item.daysUntilExpiry} วัน`,
          size: "xs",
          color: COLOR.warn,
          weight: "bold",
          margin: "sm"
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: COLOR.green,
          action: {
            type: "postback",
            label: "รับทราบ",
            data: `action=ack_expiry&itemId=${encodeURIComponent(item.itemId)}&lotNo=${encodeURIComponent(item.lotNo)}&expDate=${encodeURIComponent(item.expDate)}`
          }
        }
      ]
    }
  }));

  return {
    type: "flex",
    altText: "แจ้งเตือนน้ำยาใกล้หมดอายุ",
    contents: {
      type: "carousel",
      contents: carouselBubbles
    }
  };
}

export function generateWeeklyStockSummaryTemplate(vendor: string, items: WeeklyStockSummaryItem[]) {
  const itemRows = items.slice(0, 12).map((item) => ({
    type: "box",
    layout: "horizontal",
    margin: "md",
    contents: [
      {
        type: "text",
        text: item.name,
        size: "xs",
        color: COLOR.ink,
        wrap: true,
        flex: 4
      },
      {
        type: "text",
        text: `${item.quantity} ${item.unit}`,
        size: "xs",
        weight: "bold",
        color: COLOR.ink,
        align: "end",
        flex: 2
      }
    ]
  }));

  return {
    type: "flex",
    altText: `สรุปสต๊อกรายสัปดาห์ของ ${vendor}`,
    contents: {
      type: "bubble",
      header: darkHeader("สต็อกรายสัปดาห์", vendor),
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "สรุปปริมาณน้ำยาคงเหลือประจำสัปดาห์หลังการนับ",
            size: "xs",
            color: COLOR.inkMuted,
            wrap: true
          },
          {
            type: "separator",
            margin: "lg"
          },
          ...itemRows
        ]
      }
    }
  };
}
