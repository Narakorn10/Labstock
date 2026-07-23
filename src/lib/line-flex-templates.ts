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
}

export interface ExpiringSoonItem {
  itemId: string;
  name: string;
  lotNo: string;
  expDate: string;
  quantity: number;
  unit: string;
  daysUntilExpiry: number;
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

const chunk = <T,>(items: T[], size: number) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, (index + 1) * size),
);

function weeklyAlertBubble(title: string, subtitle: string, color: string, rows: Array<Record<string, unknown>>) {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: color,
        contents: [
          { type: "text", text: "WEEKLY STOCK ALERT", color: "#ffffff", size: "xs", weight: "bold" },
          { type: "text", text: title, color: "#ffffff", size: "lg", weight: "bold", margin: "sm", wrap: true },
          { type: "text", text: subtitle, color: "#ffffff", size: "xs", margin: "sm", wrap: true },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: rows.length ? rows : [{ type: "text", text: "ไม่มีรายการที่ต้องดำเนินการ", size: "sm", color: "#16A34A", wrap: true }],
      },
    },
  };
}

function addWeeklyOrderFooter(bubble: Record<string, unknown>, orderUrl?: string) {
  if (!orderUrl) return bubble;

  const contents = bubble.contents as Record<string, unknown>;
  contents.footer = {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [{
      type: "button",
      style: "primary",
      color: "#0F766E",
      action: {
        type: "uri",
        label: "เปิดเมนูสั่งน้ำยา",
        uri: orderUrl,
      },
    }],
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
    "#1D4ED8",
    [
      { type: "text", text: `สต็อกใกล้หมด: ${totalLowStock} รายการ`, size: "md", weight: "bold", color: "#DC2626" },
      { type: "text", text: `ใกล้หมดอายุภายใน 30 วัน: ${totalExpiring} lot`, size: "md", weight: "bold", color: "#EA580C", margin: "md" },
      { type: "text", text: "รายละเอียดอยู่ในการ์ดถัดไป", size: "xs", color: "#6B7280", margin: "lg" },
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
      "#DC2626",
      page.map((item, index) => ({
        type: "box", layout: "vertical", margin: index === 0 ? "none" : "md", contents: [
          { type: "text", text: `${pageIndex * 10 + index + 1}. ${item.name}`, size: "sm", weight: "bold", wrap: true, color: "#111827" },
          { type: "text", text: `คงเหลือ ${item.quantity} ${item.unit} • ขั้นต่ำ ${item.minThreshold} ${item.unit}`, size: "xs", color: "#DC2626", margin: "sm", wrap: true },
        ],
      })),
    )));
  }

  const expiryPages = chunk(alerts.expiringSoonItems, 10);
  expiryPages.forEach((page, pageIndex) => messages.push(weeklyAlertBubble(
    "น้ำยาใกล้หมดอายุ",
    `${alerts.expiringSoonItems.length} lot ภายใน 30 วัน${expiryPages.length > 1 ? ` • หน้า ${pageIndex + 1}/${expiryPages.length}` : ""}`,
    "#EA580C",
    page.map((item, index) => ({
      type: "box", layout: "vertical", margin: index === 0 ? "none" : "md", contents: [
        { type: "text", text: `${pageIndex * 10 + index + 1}. ${item.name}`, size: "sm", weight: "bold", wrap: true, color: "#111827" },
        { type: "text", text: `งาน: ${item.jobType || "ไม่ระบุงาน"} • Lot ${item.lotNo}`, size: "xs", color: "#6B7280", margin: "sm", wrap: true },
        { type: "text", text: `หมดอายุ ${item.expDate} • เหลือ ${item.quantity} ${item.unit} • อีก ${item.daysUntilExpiry} วัน`, size: "xs", color: "#EA580C", margin: "sm", wrap: true },
      ],
    })),
  )));

  return messages;
}

export function generatePONotificationTemplate(po: PurchaseOrder) {
  const itemComponents = po.items?.map(item => ({
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: item.item_name,
        size: "sm",
        color: "#555555",
        flex: 0
      },
      {
        type: "text",
        text: `${item.quantity} ${item.unit}`,
        size: "sm",
        color: "#111111",
        align: "end"
      }
    ]
  })) || [];

  return {
    type: "flex",
    altText: `New Purchase Order: ${po.po_number}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "NEW PURCHASE ORDER",
            color: "#ffffff",
            weight: "bold",
            size: "sm"
          },
          {
            type: "text",
            text: po.po_number,
            color: "#ffffff",
            weight: "bold",
            size: "xl",
            margin: "md"
          }
        ],
        backgroundColor: "#2563EB"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `Vendor: ${po.vendor}`,
            weight: "bold",
            size: "md",
            margin: "md"
          },
          {
            type: "separator",
            margin: "xxl"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "xxl",
            spacing: "sm",
            contents: itemComponents
          }
        ]
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
            action: {
              type: "postback",
              label: "✅ ยืนยัน",
              data: `action=confirm_po&id=${po.po_number}`
            }
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: {
              type: "postback",
              label: "❌ ปฏิเสธ",
              data: `action=reject_po&id=${po.po_number}`
            }
          }
        ],
        flex: 0
      }
    }
  };
}

export function generatePOStatusTemplate(po: PurchaseOrder) {
  return {
    type: "flex",
    altText: `PO Status: ${po.po_number}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "PO STATUS",
            weight: "bold",
            color: "#2563EB",
            size: "sm"
          },
          {
            type: "text",
            text: po.po_number,
            weight: "bold",
            size: "xxl",
            margin: "md"
          },
          {
            type: "text",
            text: `Status: ${po.status}`,
            size: "xs",
            color: "#aaaaaa",
            wrap: true
          },
          {
            type: "separator",
            margin: "xxl"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "xxl",
            spacing: "sm",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "Expected Date",
                    size: "sm",
                    color: "#555555",
                    flex: 0
                  },
                  {
                    type: "text",
                    text: po.expected_date ? new Date(po.expected_date).toLocaleDateString() : 'N/A',
                    size: "sm",
                    color: "#111111",
                    align: "end"
                  }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "link",
            height: "sm",
            action: {
              type: "uri",
              label: "🔗 ดูบนเว็บ",
              uri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/orders/${po.id || po.po_number}`
            }
          }
        ],
        flex: 0
      }
    }
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
        color: "#aaaaaa",
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
            color: "#111111"
          },
          {
            type: "text",
            text: event.location,
            size: "xs",
            color: "#555555"
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
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `Provider: ${tracking.provider}`,
            color: "#ffffff",
            weight: "bold",
            size: "sm"
          },
          {
            type: "text",
            text: tracking.trackingNo,
            color: "#ffffff",
            weight: "bold",
            size: "xl",
            margin: "md"
          }
        ],
        backgroundColor: "#10B981"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: tracking.statusText,
            weight: "bold",
            size: "md"
          },
          {
            type: "separator",
            margin: "xxl"
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
          text: "LOW STOCK",
          weight: "bold",
          color: "#EF4444",
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
          text: `Current: ${item.quantity} ${item.unit}`,
          size: "sm",
          margin: "sm"
        },
        {
          type: "text",
          text: `Min: ${item.minThreshold} ${item.unit}`,
          size: "xs",
          color: "#aaaaaa"
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
          color: "#EF4444",
          action: {
            type: "uri",
            label: "🛒 สั่งซื้อ",
            uri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/orders?suggest=true`
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
          color: "#F97316",
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
          color: "#555555",
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
          color: "#555555",
          margin: "sm"
        },
        {
          type: "text",
          text: `เหลืออีก ${item.daysUntilExpiry} วัน`,
          size: "xs",
          color: "#F97316",
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
          color: "#F97316",
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
        color: "#111111",
        wrap: true,
        flex: 4
      },
      {
        type: "text",
        text: `${item.quantity} ${item.unit}`,
        size: "xs",
        color: "#2563EB",
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
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "WEEKLY STOCK",
            color: "#ffffff",
            weight: "bold",
            size: "sm"
          },
          {
            type: "text",
            text: vendor,
            color: "#ffffff",
            weight: "bold",
            size: "lg",
            margin: "sm",
            wrap: true
          }
        ],
        backgroundColor: "#2563EB"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "สรุปปริมาณน้ำยาคงเหลือประจำสัปดาห์หลังการนับ",
            size: "xs",
            color: "#555555",
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
