import { messagingApi } from "@line/bot-sdk";
import {
  ExpiringSoonItem,
  generateExpiringSoonTemplate,
  generateLowStockTemplate,
  generatePONotificationTemplate,
  generatePOStatusTemplate,
  generateTrackingTemplate,
  generateWeeklyStockSummaryTemplate,
  LowStockItem,
  PurchaseOrder,
  TrackingResult,
  WeeklyStockSummaryItem,
} from "./line-flex-templates";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "DUMMY_TOKEN",
};

export const lineClient = new messagingApi.MessagingApiClient(config);

const getAppBaseUrl = () => {
  const explicitUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionUrl) return `https://${productionUrl}`;

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;

  return "http://localhost:3000";
};

export const getLineDispenseUrl = () => {
  const explicitLiffUrl = process.env.NEXT_PUBLIC_LINE_DISPENSE_LIFF_URL?.trim();
  if (explicitLiffUrl) return explicitLiffUrl;

  const liffId = process.env.NEXT_PUBLIC_LINE_DISPENSE_LIFF_ID?.trim();
  if (liffId) return `https://liff.line.me/${liffId}`;

  return `${getAppBaseUrl()}/liff/dispense`;
};

type StockSummaryLineItem = {
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  minThreshold?: number;
  jobType?: string;
};

export async function sendLinePush(to: string, messages: messagingApi.Message[]) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN === "DUMMY_TOKEN") {
    console.warn("LINE_CHANNEL_ACCESS_TOKEN not set, skipping push to", to);
    return;
  }
  try {
    await lineClient.pushMessage({ to, messages });
  } catch (error) {
    console.error("Error sending LINE push message:", error);
  }
}

export async function sendLineReply(replyToken: string, messages: messagingApi.Message[]) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN === "DUMMY_TOKEN") {
    console.warn("LINE_CHANNEL_ACCESS_TOKEN not set, skipping reply");
    return;
  }
  try {
    await lineClient.replyMessage({ replyToken, messages });
  } catch (error) {
    console.error("Error sending LINE reply:", error);
  }
}

export async function pushPONotification(lineUserId: string, po: PurchaseOrder) {
  const template = generatePONotificationTemplate(po);
  await sendLinePush(lineUserId, [template as messagingApi.Message]);
}

export async function pushTrackingUpdate(lineUserId: string, tracking: TrackingResult) {
  const template = generateTrackingTemplate(tracking);
  await sendLinePush(lineUserId, [template as messagingApi.Message]);
}

export async function pushLowStockAlert(lineUserId: string, items: LowStockItem[]) {
  const template = generateLowStockTemplate(items);
  await sendLinePush(lineUserId, [template as messagingApi.Message]);
}

export async function pushExpiringSoonAlert(lineUserId: string, items: ExpiringSoonItem[]) {
  const template = generateExpiringSoonTemplate(items);
  await sendLinePush(lineUserId, [template as messagingApi.Message]);
}

export async function pushWeeklyStockSummary(lineUserId: string, vendor: string, items: WeeklyStockSummaryItem[]) {
  const template = generateWeeklyStockSummaryTemplate(vendor, items);
  await sendLinePush(lineUserId, [template as messagingApi.Message]);
}

export async function replyPODetail(replyToken: string, po: PurchaseOrder) {
  const template = generatePOStatusTemplate(po);
  await sendLineReply(replyToken, [template as messagingApi.Message]);
}

export async function replyTrackingStatus(replyToken: string, tracking: TrackingResult) {
  const template = generateTrackingTemplate(tracking);
  await sendLineReply(replyToken, [template as messagingApi.Message]);
}

export async function replyLowStock(replyToken: string, items: LowStockItem[]) {
  const template = generateLowStockTemplate(items);
  await sendLineReply(replyToken, [template as messagingApi.Message]);
}

export async function replyDispenseMenu(replyToken: string) {
  await sendLineReply(replyToken, [{
    type: "template",
    altText: "Open LabStock dispense menu",
    template: {
      type: "buttons",
      title: "LabStock",
      text: "เปิดเมนูเบิกน้ำยาใน LINE",
      actions: [{
        type: "uri",
        label: "เปิดเมนูเบิก",
        uri: getLineDispenseUrl(),
      }],
    },
  } as messagingApi.Message]);
}

function formatLineStockSummary(title: string, items: StockSummaryLineItem[]) {
  if (items.length === 0) {
    return `${title}\nไม่พบรายการน้ำยาที่ตรงกับคำค้น`;
  }

  const lines = items.map((item) => {
    const minPart = typeof item.minThreshold === "number" ? ` | Min ${item.minThreshold}` : "";
    const jobPart = item.jobType ? ` | ${item.jobType}` : "";
    return `- ${item.name} (${item.itemId})\n  คงเหลือ ${item.quantity} ${item.unit}${minPart}${jobPart}`;
  });

  return `${title}\n${lines.join("\n")}`;
}

export async function replyStockSummary(
  replyToken: string,
  title: string,
  items: StockSummaryLineItem[],
) {
  await sendLineReply(replyToken, [{
    type: "text",
    text: formatLineStockSummary(title, items),
  }]);
}

export async function replyHelp(replyToken: string) {
  await sendLineReply(replyToken, [{
    type: "text",
    text: [
      "คำสั่งที่ใช้งานได้:",
      "- พิมพ์ 'id' หรือ 'ลงทะเบียน' เพื่อดู User ID ของคุณ",
      "- พิมพ์เลข PO (เช่น PO-20250613) เพื่อดูสถานะ",
      "- พิมพ์เลขพัสดุ (เช่น EY123456789TH) เพื่อดู Tracking",
      "- พิมพ์ 'stock' หรือ 'สต๊อก' เพื่อดูรายการน้ำยาที่ต่ำกว่า Min Stock",
      "- พิมพ์ 'stock <คำค้น>' หรือ 'สต๊อก <คำค้น>' เพื่อค้นหายอดน้ำยาตามรหัส/ชื่อ/บาร์โค้ด",
      "- พิมพ์ 'สั่งซื้อ' เพื่อเอาลิงก์ไปสร้างใบสั่งซื้อ",
      "- สำหรับ Vendor สามารถกดยืนยัน/ปฏิเสธ PO จากการ์ดแจ้งเตือนได้เลย",
    ].join("\n"),
  }]);
}
