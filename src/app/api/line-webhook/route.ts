import { NextResponse } from 'next/server';
import { validateSignature, webhook } from '@line/bot-sdk';
import { replyHelp, replyPODetail, replyTrackingStatus, replyLowStock, sendLineReply } from '@/lib/line-bot';
import sql from '@/lib/db';
import type { LowStockItem, PurchaseOrder, TrackingResult } from '@/lib/line-flex-templates';

const channelSecret = process.env.LINE_CHANNEL_SECRET || 'DUMMY_SECRET';

const isCommand = (text: string, english: string, thai: string) => {
  const trimmed = text.trim();
  return trimmed.toLowerCase() === english || trimmed === thai;
};

const extractStockSearch = (text: string) => {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('stock ')) return trimmed.slice(6).trim();
  if (lower.startsWith('stock:')) return trimmed.slice(6).trim();
  if (trimmed.startsWith('สต๊อก ')) return trimmed.slice(6).trim();
  if (trimmed.startsWith('สต๊อก:')) return trimmed.slice(6).trim();

  return '';
};

const parseJobTypeCommand = (text: string) => {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const summaryCommands = new Set([
    'job',
    'jobs',
    'stock by job',
    'งาน',
    'ประเภทงาน',
    'จำนวนน้ำยาตามงาน',
  ]);

  if (summaryCommands.has(lower) || summaryCommands.has(trimmed)) {
    return { matched: true, keyword: '' };
  }

  if (lower.startsWith('job ')) return { matched: true, keyword: trimmed.slice(4).trim() };
  if (lower.startsWith('job:')) return { matched: true, keyword: trimmed.slice(4).trim() };
  if (trimmed.startsWith('งาน ')) return { matched: true, keyword: trimmed.slice(4).trim() };
  if (trimmed.startsWith('งาน:')) return { matched: true, keyword: trimmed.slice(4).trim() };
  if (trimmed.startsWith('ประเภทงาน ')) return { matched: true, keyword: trimmed.slice(9).trim() };
  if (trimmed.startsWith('ประเภทงาน:')) return { matched: true, keyword: trimmed.slice(9).trim() };

  return { matched: false, keyword: '' };
};

async function replyText(replyToken: string, text: string) {
  await sendLineReply(replyToken, [{ type: 'text', text }]);
}

function getReplyToken(event: webhook.Event) {
  if ('replyToken' in event && typeof event.replyToken === 'string') {
    return event.replyToken;
  }

  return '';
}

const followReplyText = [
  'Welcome to LabStock LINE.',
  '',
  'Type "id" to register this LINE account.',
  'Type "help" to see commands.',
  'For stock search, type: stock <keyword>',
].join('\n');

const groupJoinReplyText = [
  'LabStock bot joined this chat.',
  '',
  'Group/room replies are supported for commands such as help, stock, PO, and tracking.',
  'For private registration, chat 1:1 with this bot and type "id".',
].join('\n');

const memberJoinReplyText = [
  'Welcome to LabStock.',
  '',
  'Type "help" to see available commands.',
  'For private registration, chat 1:1 with this bot and type "id".',
].join('\n');

async function replyStockSearch(replyToken: string, keyword: string) {
  const likeKeyword = `%${keyword}%`;
  const rows = await sql`
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
    LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
    WHERE m.item_id ILIKE ${likeKeyword}
       OR m.name ILIKE ${likeKeyword}
       OR COALESCE(m.barcode, '') ILIKE ${likeKeyword}
    ORDER BY m.item_id ASC
    LIMIT 5
  `;

  if (rows.length === 0) {
    await replyText(replyToken, `ไม่พบรายการสต๊อกที่ตรงกับ "${keyword}" ค่ะ`);
    return;
  }

  const lines = rows.map((row) => {
    const quantity = Number(row.quantity || 0);
    const unit = row.unit || '';

    return [
      `${row.name}`,
      `คงเหลือ: ${quantity} ${unit}`,
    ].join('\n');
  });

  await replyText(replyToken, `ผลค้นหาสต๊อก "${keyword}"\n\n${lines.join('\n\n')}`);
}

async function replyJobTypeStock(replyToken: string, keyword: string) {
  if (!keyword) {
    const rows = await sql`
      WITH InventorySummary AS (
        SELECT
          item_id,
          SUM(quantity) as current_qty
        FROM inventory
        GROUP BY item_id
      )
      SELECT
        COALESCE(NULLIF(m.job_type, ''), 'ไม่ระบุงาน') as "jobType",
        m.name,
        m.unit,
        COALESCE(i.current_qty, 0) as quantity
      FROM master_data m
      LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
      ORDER BY COALESCE(NULLIF(m.job_type, ''), 'ไม่ระบุงาน') ASC, m.name ASC
      LIMIT 30
    `;

    if (rows.length === 0) {
      await replyText(replyToken, 'ยังไม่มีข้อมูลน้ำยาในระบบค่ะ');
      return;
    }

    const lines = rows.map((row) => {
      const quantity = Number(row.quantity || 0);
      const unit = row.unit || '';

      return `${row.jobType} - ${row.name}\nคงเหลือ: ${quantity} ${unit}`;
    });

    await replyText(replyToken, `จำนวนน้ำยาตามประเภทงาน\n\n${lines.join('\n\n')}`);
    return;
  }

  const likeKeyword = `%${keyword}%`;
  const rows = await sql`
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
      COALESCE(NULLIF(m.job_type, ''), 'ไม่ระบุงาน') as "jobType",
      m.unit,
      m.min_threshold as "minThreshold",
      COALESCE(i.current_qty, 0) as quantity
    FROM master_data m
    LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
    WHERE COALESCE(NULLIF(m.job_type, ''), 'ไม่ระบุงาน') ILIKE ${likeKeyword}
    ORDER BY m.item_id ASC
    LIMIT 10
  `;

  if (rows.length === 0) {
    await replyText(replyToken, `ไม่พบประเภทงาน "${keyword}" ค่ะ`);
    return;
  }

  const lines = rows.map((row) => {
    const quantity = Number(row.quantity || 0);
    const unit = row.unit || '';

    return `${row.name}\nคงเหลือ: ${quantity} ${unit}`;
  });

  await replyText(replyToken, `น้ำยาในประเภทงาน "${rows[0].jobType}"\n\n${lines.join('\n\n')}`);
}

async function replyLowStockSummary(replyToken: string) {
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
    LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
    WHERE COALESCE(i.current_qty, 0) <= m.min_threshold
    ORDER BY COALESCE(i.current_qty, 0) ASC, m.item_id ASC
    LIMIT 10
  `;

  if (lowStockData.length > 0) {
    await replyLowStock(replyToken, lowStockData as unknown as LowStockItem[]);
    return;
  }

  await replyText(replyToken, 'ไม่มีรายการน้ำยาที่ต่ำกว่า Min Stock ในขณะนี้ค่ะ');
}

export async function POST(req: Request) {
  try {
    const bodyText = await req.text();
    const signature = req.headers.get('x-line-signature') || '';

    console.log('[LINE Webhook] Received event');

    if (process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_SECRET !== 'DUMMY_SECRET') {
      if (!validateSignature(bodyText, channelSecret, signature)) {
        console.error('[LINE Webhook] Invalid signature. Check your LINE_CHANNEL_SECRET.');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    const body = JSON.parse(bodyText) as { events?: webhook.Event[] };
    const events = Array.isArray(body.events) ? body.events : [];
    
    console.log(`[LINE Webhook] Processing ${events.length} events`);

    await Promise.all(events.map(async (event) => {
      console.log(`[LINE Webhook] Event Type: ${event.type}`);
      
      // Handle messages
      if (event.type === 'message' && event.message.type === 'text') {
        const text = (event.message as webhook.TextMessageContent).text.trim();
        const replyToken = getReplyToken(event);
        
        console.log(`[LINE Webhook] Text received: "${text}"`);

        if (!replyToken) return;

        const stockSearch = extractStockSearch(text);
        const jobTypeCommand = parseJobTypeCommand(text);

        if (isCommand(text, 'help', 'เมนู')) {
          console.log('[LINE Webhook] Replying with Help');
          await replyHelp(replyToken);
        } else if (isCommand(text, 'id', 'ลงทะเบียน')) {
          const userId = event.source?.userId;
          console.log(`[LINE Webhook] User requested ID: ${userId}`);
          if (!userId) return;

          await replyText(replyToken, `LINE User ID ของคุณคือ:\n${userId}\n\nกรุณาคัดลอกไปวางในเมนู "ตั้งค่าการแจ้งเตือน" ในระบบ LabStock เพื่อเปิดรับการแจ้งเตือนค่ะ`);
        } else if (jobTypeCommand.matched) {
          await replyJobTypeStock(replyToken, jobTypeCommand.keyword);
        } else if (stockSearch) {
          await replyStockSearch(replyToken, stockSearch);
        } else if (isCommand(text, 'stock', 'สต๊อก')) {
          await replyLowStockSummary(replyToken);
        } else if (text.toUpperCase().startsWith('PO-')) {
          const poNumber = text.toUpperCase();
          const poData = await sql`SELECT * FROM purchase_orders WHERE po_number = ${poNumber}`;
          if (poData.length > 0) {
            const itemsData = await sql`SELECT item_name, quantity, unit FROM purchase_order_items WHERE po_id = ${poData[0].id}`;
            const po = { ...poData[0], items: itemsData } as unknown as PurchaseOrder;
            await replyPODetail(replyToken, po);
          } else {
            await replyText(replyToken, `ไม่พบใบสั่งซื้อหมายเลข ${poNumber} ในระบบค่ะ`);
          }
        } else if (text.match(/^[A-Z]{2}[0-9]{9}[A-Z]{2}$/)) {
          // EMS Tracking format e.g. EY123456789TH
          const shipments = await sql`SELECT * FROM shipments WHERE tracking_no = ${text}`;
          if (shipments.length > 0) {
            const tracking: TrackingResult = {
              provider: shipments[0].tracking_provider || 'Unknown',
              trackingNo: text,
              status: shipments[0].tracking_status || 'UNKNOWN',
              statusText: 'พัสดุอยู่ในระบบ',
              lastUpdate: new Date().toISOString(),
              history: []
            };
            await replyTrackingStatus(replyToken, tracking);
          } else {
            await replyText(replyToken, `ไม่พบข้อมูลพัสดุ ${text} ในระบบค่ะ`);
          }
        } else if (isCommand(text, 'order', 'สั่งซื้อ')) {
          await replyText(replyToken, `กรุณาเข้าสู่ระบบเพื่อสร้างใบสั่งซื้อ: ${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/orders`);
        } else {
          // Unrecognized command
          await replyHelp(replyToken);
        }
      }
      else if (event.type === 'follow') {
        const replyToken = getReplyToken(event);
        if (!replyToken) return;
        await replyText(replyToken, followReplyText);
      }
      else if (event.type === 'join') {
        const replyToken = getReplyToken(event);
        if (!replyToken) return;
        await replyText(replyToken, groupJoinReplyText);
      }
      else if (event.type === 'memberJoined') {
        const replyToken = getReplyToken(event);
        if (!replyToken) return;
        await replyText(replyToken, memberJoinReplyText);
      }
      // Handle postback (button clicks in Flex messages)
      else if (event.type === 'postback') {
        const postbackEvent = event as webhook.PostbackEvent;
        const data = new URLSearchParams(postbackEvent.postback.data);
        const action = data.get('action');
        const id = data.get('id'); // po_number
        const replyToken = getReplyToken(event);

        if (!replyToken) return;

        if (action === 'confirm_po' && id) {
          await sql`UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = NOW() WHERE po_number = ${id}`;
          await replyText(replyToken, `ยืนยันใบสั่งซื้อ ${id} เรียบร้อยแล้ว ระบบได้แจ้งเตือนให้ Lab ทราบแล้วค่ะ`);
        } else if (action === 'reject_po' && id) {
          await sql`UPDATE purchase_orders SET status = 'REJECTED' WHERE po_number = ${id}`;
          await replyText(replyToken, `ปฏิเสธใบสั่งซื้อ ${id} เรียบร้อยแล้วค่ะ`);
        }
      }
    }));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Webhook processing error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
