import { messagingApi } from '@line/bot-sdk';
import { PurchaseOrder, TrackingResult, LowStockItem, generatePONotificationTemplate, generatePOStatusTemplate, generateTrackingTemplate, generateLowStockTemplate } from './line-flex-templates';

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'DUMMY_TOKEN'
};

export const lineClient = new messagingApi.MessagingApiClient(config);

export async function sendLinePush(to: string, messages: unknown[]) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN === 'DUMMY_TOKEN') {
    console.warn('LINE_CHANNEL_ACCESS_TOKEN not set, skipping push to', to);
    return;
  }
  try {
    await lineClient.pushMessage({ to, messages: messages as messagingApi.Message[] });
  } catch (error) {
    console.error('Error sending LINE push message:', error);
  }
}

export async function sendLineReply(replyToken: string, messages: unknown[]) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN === 'DUMMY_TOKEN') {
    console.warn('LINE_CHANNEL_ACCESS_TOKEN not set, skipping reply');
    return;
  }
  try {
    await lineClient.replyMessage({ replyToken, messages: messages as messagingApi.Message[] });
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
    text: [
      'LabStock LINE Commands',
      '',
      'Register',
      '- id',
      '- ลงทะเบียน',
      '  Show your LINE User ID for notification setup.',
      '',
      'Stock',
      '- stock',
      '- สต๊อก',
      '  Show low-stock reagent list.',
      '- stock <keyword>',
      '- สต๊อก <keyword>',
      '  Search by item ID, reagent name, or barcode.',
      '',
      'Stock by job type',
      '- job',
      '- jobs',
      '- งาน',
      '- ประเภทงาน',
      '  Show reagent count grouped by job type.',
      '- job <job type>',
      '- งาน <ประเภทงาน>',
      '  Show reagent stock in one job type.',
      '',
      'Purchase order',
      '- PO-20250613',
      '  Show purchase order status.',
      '- order',
      '- สั่งซื้อ',
      '  Open purchase order page.',
      '',
      'Tracking',
      '- EY123456789TH',
      '  Show parcel tracking status.',
      '',
      'Group chat',
      '- Add this bot to a group/room and type help.',
      '- For private registration, chat 1:1 with the bot and type id.',
    ].join('\n')
  }]);
}
