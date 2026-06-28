import { messagingApi } from "@line/bot-sdk";
import {
  PurchaseOrder,
  TrackingResult,
  LowStockItem,
  generateLowStockTemplate,
  generatePONotificationTemplate,
  generatePOStatusTemplate,
  generateTrackingTemplate,
} from "./line-flex-templates";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "DUMMY_TOKEN",
};

export const lineClient = new messagingApi.MessagingApiClient(config);

export async function sendLinePush(to: string, messages: unknown[]) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN === "DUMMY_TOKEN") {
    console.warn("LINE_CHANNEL_ACCESS_TOKEN not set, skipping push to", to);
    return;
  }

  try {
    await lineClient.pushMessage({ to, messages: messages as messagingApi.Message[] });
  } catch (error) {
    console.error("Error sending LINE push message:", error);
  }
}

export async function sendLineReply(replyToken: string, messages: unknown[]) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN === "DUMMY_TOKEN") {
    console.warn("LINE_CHANNEL_ACCESS_TOKEN not set, skipping reply");
    return;
  }

  try {
    const replyMessages = attachDefaultQuickReply(messages);
    await lineClient.replyMessage({ replyToken, messages: replyMessages as messagingApi.Message[] });
  } catch (error) {
    console.error("Error sending LINE reply:", error);
  }
}

export async function pushPONotification(lineUserId: string, po: PurchaseOrder) {
  const template = generatePONotificationTemplate(po);
  await sendLinePush(lineUserId, [template]);
}

export async function pushTrackingUpdate(lineUserId: string, tracking: TrackingResult) {
  const template = generateTrackingTemplate(tracking);
  await sendLinePush(lineUserId, [template]);
}

export async function pushLowStockAlert(lineUserId: string, items: LowStockItem[]) {
  const template = generateLowStockTemplate(items);
  await sendLinePush(lineUserId, [template]);
}

export async function replyPODetail(replyToken: string, po: PurchaseOrder) {
  const template = generatePOStatusTemplate(po);
  await sendLineReply(replyToken, [template]);
}

export async function replyTrackingStatus(replyToken: string, tracking: TrackingResult) {
  const template = generateTrackingTemplate(tracking);
  await sendLineReply(replyToken, [template]);
}

export async function replyLowStock(replyToken: string, items: LowStockItem[]) {
  const template = generateLowStockTemplate(items);
  await sendLineReply(replyToken, [template]);
}

const lineCommandQuickReply: messagingApi.QuickReply = {
  items: [
    {
      type: "action",
      action: { type: "message", label: "ลงทะเบียน", text: "id" },
    },
    {
      type: "action",
      action: { type: "message", label: "สต๊อกต่ำ", text: "stock" },
    },
    {
      type: "action",
      action: { type: "message", label: "ตามงาน/เครื่อง", text: "job" },
    },
    {
      type: "action",
      action: { type: "message", label: "สั่งซื้อ", text: "order" },
    },
    {
      type: "action",
      action: { type: "message", label: "Help", text: "help" },
    },
  ],
};

function attachDefaultQuickReply(messages: unknown[]) {
  if (messages.length === 0) return messages;

  return messages.map((message, index) => {
    if (index !== messages.length - 1 || typeof message !== "object" || message === null || Array.isArray(message)) {
      return message;
    }

    const lineMessage = message as Record<string, unknown>;
    if (lineMessage.quickReply) return message;

    return {
      ...lineMessage,
      quickReply: lineCommandQuickReply,
    };
  });
}

export async function replyHelp(replyToken: string) {
  await sendLineReply(replyToken, [
    {
      type: "text",
      text: [
        "LabStock LINE Commands",
        "",
        "Register",
        "- id",
        "- ลงทะเบียน",
        "  Show your LINE User ID for notification setup.",
        "",
        "Low stock alert",
        "- stock",
        "- สต๊อก",
        "  Show low-stock reagent list.",
        "",
        "Keyword search",
        "- stock <keyword>",
        "- สต๊อก <keyword>",
        "  Search by item ID, reagent name, or barcode.",
        "",
        "Stock by job and machine",
        "- job",
        "- jobs",
        "- งาน",
        "- ประเภทงาน",
        "  Show grouped stock summary by job type and machine type.",
        "- job <job type>",
        "- งาน <ประเภทงาน>",
        "  Show items inside one job type.",
        "",
        "Dispense",
        "- dispense <itemId> <qty>",
        "- เบิก <itemId> <qty>",
        "  Preview FEFO lots first, then confirm in LINE.",
        "",
        "Purchase order",
        "- PO-20250613",
        "  Show purchase order status.",
        "- order",
        "- สั่งซื้อ",
        "  Open purchase order page.",
        "",
        "Tracking",
        "- EY123456789TH",
        "  Show parcel tracking status.",
      ].join("\n"),
      quickReply: lineCommandQuickReply,
    },
  ]);
}
