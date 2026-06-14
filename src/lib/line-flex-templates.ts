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
