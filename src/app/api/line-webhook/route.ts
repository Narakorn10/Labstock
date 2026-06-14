import { NextResponse } from 'next/server';
import { validateSignature, webhook } from '@line/bot-sdk';
import { replyHelp, replyPODetail, replyTrackingStatus, replyLowStock } from '@/lib/line-bot';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');
const channelSecret = process.env.LINE_CHANNEL_SECRET || 'DUMMY_SECRET';

export async function POST(req: Request) {
  try {
    const bodyText = await req.text();
    const signature = req.headers.get('x-line-signature') || '';

    if (process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_SECRET !== 'DUMMY_SECRET') {
      if (!validateSignature(bodyText, channelSecret, signature)) {
        console.error('Invalid LINE signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    const body = JSON.parse(bodyText);
    const events: webhook.Event[] = body.events;

    await Promise.all(events.map(async (event) => {
      // Handle messages
      if (event.type === 'message' && event.message.type === 'text') {
        const text = (event.message as webhook.TextMessageContent).text.trim();
        const replyToken = (event as any).replyToken as string | undefined;

        if (!replyToken) return;

        if (text.toLowerCase() === 'help' || text === 'เมนู') {
          await replyHelp(replyToken);
        } else if (text.toLowerCase() === 'id' || text === 'ลงทะเบียน') {
          const userId = event.source.userId;
          const { lineClient } = await import('@/lib/line-bot');
          await lineClient.replyMessage({ 
            replyToken, 
            messages: [{ 
              type: 'text', 
              text: `LINE User ID ของคุณคือ:\n${userId}\n\nกรุณาคัดลอกไปวางในเมนู "ตั้งค่าการแจ้งเตือน" ในระบบ LabStock เพื่อเปิดรับการแจ้งเตือนค่ะ` 
            }] 
          });
        } else if (text.toLowerCase() === 'stock' || text === 'สต๊อก') {
          // Fetch low stock items
          const lowStockData = await sql`
            WITH InventorySummary AS (
              SELECT 
                item_id,
                SUM(quantity) as current_qty
              FROM inventory
              GROUP BY item_id
            )
            SELECT 
              m.item_id as "itemId",
              m.name,
              m.unit,
              m.min_threshold as "minThreshold",
              COALESCE(i.current_qty, 0) as quantity
            FROM master_data m
            LEFT JOIN InventorySummary i ON m.item_id = i.item_id
            WHERE COALESCE(i.current_qty, 0) <= m.min_threshold
            LIMIT 10
          `;
          if (lowStockData.length > 0) {
            await replyLowStock(replyToken, lowStockData as any);
          } else {
            const { lineClient } = await import('@/lib/line-bot');
            await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: 'ไม่มีรายการน้ำยาที่ต่ำกว่า Min Stock ในขณะนี้ค่ะ 🎉' }] });
          }
        } else if (text.toUpperCase().startsWith('PO-')) {
          const poNumber = text.toUpperCase();
          const poData = await sql`SELECT * FROM purchase_orders WHERE po_number = ${poNumber}`;
          if (poData.length > 0) {
            const itemsData = await sql`SELECT item_name, quantity, unit FROM purchase_order_items WHERE po_id = ${poData[0].id}`;
            const po = { ...poData[0], items: itemsData };
            await replyPODetail(replyToken, po as any);
          } else {
            const { lineClient } = await import('@/lib/line-bot');
            await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: `ไม่พบใบสั่งซื้อหมายเลข ${poNumber} ในระบบค่ะ` }] });
          }
        } else if (text.match(/^[A-Z]{2}[0-9]{9}[A-Z]{2}$/)) {
          // EMS Tracking format e.g. EY123456789TH
          const shipments = await sql`SELECT * FROM shipments WHERE tracking_no = ${text}`;
          if (shipments.length > 0) {
            const tracking = {
              provider: shipments[0].tracking_provider || 'Unknown',
              trackingNo: text,
              status: shipments[0].tracking_status || 'UNKNOWN',
              statusText: 'พัสดุอยู่ในระบบ',
              lastUpdate: new Date().toISOString(),
              history: []
            };
            await replyTrackingStatus(replyToken, tracking as any);
          } else {
            const { lineClient } = await import('@/lib/line-bot');
            await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: `ไม่พบข้อมูลพัสดุ ${text} ในระบบค่ะ` }] });
          }
        } else if (text === 'สั่งซื้อ' || text.toLowerCase() === 'order') {
          const { lineClient } = await import('@/lib/line-bot');
          await lineClient.replyMessage({ replyToken, messages: [{ 
            type: 'text', 
            text: `กรุณาเข้าสู่ระบบเพื่อสร้างใบสั่งซื้อ: ${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/orders` 
          }] });
        } else {
          // Unrecognized command
          await replyHelp(replyToken);
        }
      } 
      // Handle postback (button clicks in Flex messages)
      else if (event.type === 'postback') {
        const postbackEvent = event as webhook.PostbackEvent;
        const data = new URLSearchParams(postbackEvent.postback.data);
        const action = data.get('action');
        const id = data.get('id'); // po_number
        const replyToken = (event as any).replyToken as string | undefined;

        if (!replyToken) return;

        if (action === 'confirm_po' && id) {
          await sql`UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = NOW() WHERE po_number = ${id}`;
          const { lineClient } = await import('@/lib/line-bot');
          await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: `ยืนยันใบสั่งซื้อ ${id} เรียบร้อยแล้ว ระบบได้แจ้งเตือนให้ Lab ทราบแล้วค่ะ` }] });
        } else if (action === 'reject_po' && id) {
          await sql`UPDATE purchase_orders SET status = 'REJECTED' WHERE po_number = ${id}`;
          const { lineClient } = await import('@/lib/line-bot');
          await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: `ปฏิเสธใบสั่งซื้อ ${id} เรียบร้อยแล้วค่ะ` }] });
        }
      }
    }));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
