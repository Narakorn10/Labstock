import { messagingApi } from '@line/bot-sdk';
import { PurchaseOrder, TrackingResult, LowStockItem, generatePONotificationTemplate, generatePOStatusTemplate, generateTrackingTemplate, generateLowStockTemplate } from './line-flex-templates';

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'DUMMY_TOKEN'
};

export const lineClient = new messagingApi.MessagingApiClient(config);

export async function sendLinePush(to: string, messages: any[]) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN === 'DUMMY_TOKEN') {
    console.warn('LINE_CHANNEL_ACCESS_TOKEN not set, skipping push to', to);
    return;
  }
  try {
    await lineClient.pushMessage({ to, messages });
  } catch (error) {
    console.error('Error sending LINE push message:', error);
  }
}

export async function sendLineReply(replyToken: string, messages: any[]) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN === 'DUMMY_TOKEN') {
    console.warn('LINE_CHANNEL_ACCESS_TOKEN not set, skipping reply');
    return;
  }
  try {
    await lineClient.replyMessage({ replyToken, messages });
  } catch (error) {
    console.error('Error sending LINE reply:', error);
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

export async function replyHelp(replyToken: string) {
  await sendLineReply(replyToken, [{
    type: 'text',
    text: `คำสั่งที่ใช้งานได้:\n- พิมพ์เลข PO (เช่น PO-20250613) เพื่อดูสถานะ\n- พิมพ์เลขพัสดุ (เช่น EY123456789TH) เพื่อดู Tracking\n- พิมพ์ 'สต๊อก' เพื่อดูรายการน้ำยาใกล้หมด\n- พิมพ์ 'สั่งซื้อ' เพื่อเอาลิงก์ไปสร้างใบสั่งซื้อ\n- สำหรับ Vendor สามารถกดยืนยัน/ปฏิเสธ PO จากการ์ดแจ้งเตือนได้เลย`
  }]);
}
