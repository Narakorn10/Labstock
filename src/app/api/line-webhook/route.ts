import { NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import { neon } from "@neondatabase/serverless";
import { getLowStockRows, searchStockRows, searchStockRowsByJob } from "@/lib/bot-stock-queries";
import { replyDispenseMenu, replyHelp, replyLowStock, replyOrderingMenu, replyPODetail, replyStockSummary, replyTrackingStatus } from "@/lib/line-bot";
import { LowStockItem, PurchaseOrder, TrackingResult } from "@/lib/line-flex-templates";

const sql = neon(process.env.DATABASE_URL || "");
const channelSecret = process.env.LINE_CHANNEL_SECRET;
const expiryNotificationType = "EXPIRING_SOON_30D";

type ReplyTextMessage = {
  type: "text";
  text: string;
};

type PurchaseOrderItem = {
  item_name: string;
  quantity: number;
  unit: string;
};

type PurchaseOrderRow = {
  id?: number;
  po_number: string;
  vendor: string;
  status: string;
  expected_date?: string | null;
};

function parseStockCommand(text: string): { keyword: string | null; searchByJob: boolean } | null {
  const trimmed = text.trim();
  const jobMatch =
    trimmed.match(/^stock\s+(?:job|งาน)\s+(.+)$/i) ??
    trimmed.match(/^สต๊อก\s*งาน\s+(.+)$/) ??
    trimmed.match(/^สต็อก\s*งาน\s+(.+)$/) ??
    trimmed.match(/^สต๊อกตามงาน\s+(.+)$/) ??
    trimmed.match(/^สต็อกตามงาน\s+(.+)$/);

  if (jobMatch) {
    return { keyword: jobMatch[1].trim(), searchByJob: true };
  }

  const match =
    trimmed.match(/^stock(?:\s+(.+))?$/i) ??
    trimmed.match(/^สต๊อก(?:\s+(.+))?$/) ??
    trimmed.match(/^สต็อก(?:\s+(.+))?$/);

  if (!match) {
    const remainingStockPhrases = [
      "จำนวนสต๊อกคงเหลือ",
      "จำนวนสต็อกคงเหลือ",
      "สต๊อกคงเหลือ",
      "สต็อกคงเหลือ",
      "สต๊อกเหลือ",
      "สต็อกเหลือ",
    ];
    const matchingPhrase = remainingStockPhrases.find((phrase) => trimmed.startsWith(phrase));

    if (matchingPhrase) {
      const keyword = trimmed.slice(matchingPhrase.length).trim();
      return keyword ? { keyword, searchByJob: false } : { keyword: null, searchByJob: false };
    }

    const remainingQuestion = trimmed.match(/^(.+?)\s+(?:เหลือเท่าไหร่|เหลือกี่(?:ขวด|กล่อง|ชิ้น)?|คงเหลือเท่าไหร่)$/);
    if (remainingQuestion) {
      return { keyword: remainingQuestion[1].trim(), searchByJob: false };
    }

    return null;
  }

  const keyword = match[1]?.trim();
  return keyword ? { keyword, searchByJob: false } : { keyword: null, searchByJob: false };
}

function isDispenseMenuCommand(text: string) {
  const normalized = text.trim().toLowerCase();
  return ["dispense", "เบิก", "เบิกน้ำยา", "เบิกจ่าย", "เมนูเบิก"].includes(normalized);
}

async function ensureExpiryAcknowledgementSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS expiry_notification_logs (
      id SERIAL PRIMARY KEY,
      item_id TEXT NOT NULL,
      lot_no TEXT NOT NULL,
      exp_date DATE NOT NULL,
      notification_type TEXT NOT NULL DEFAULT 'EXPIRING_SOON_30D',
      notified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by_line_user_id TEXT,
      UNIQUE (item_id, lot_no, exp_date, notification_type)
    )
  `;

  await sql`
    ALTER TABLE expiry_notification_logs
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE expiry_notification_logs
    ADD COLUMN IF NOT EXISTS acknowledged_by_line_user_id TEXT
  `;
}

async function sendReply(replyToken: string, message: ReplyTextMessage) {
  const { lineClient } = await import("@/lib/line-bot");
  await lineClient.replyMessage({ replyToken, messages: [message] });
}

export async function POST(req: Request) {
  try {
    const bodyText = await req.text();
    const signature = req.headers.get("x-line-signature") || "";

    console.log("[LINE Webhook] Received event");

    if (!channelSecret || channelSecret === "DUMMY_SECRET") {
      console.error("[LINE Webhook] LINE_CHANNEL_SECRET is not configured.");
      return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
    }

    if (!signature || !validateSignature(bodyText, channelSecret, signature)) {
      console.error("[LINE Webhook] Invalid signature. Check your LINE_CHANNEL_SECRET.");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(bodyText);
    const events: webhook.Event[] = body.events;

    console.log(`[LINE Webhook] Processing ${events.length} events`);

    await Promise.all(events.map(async (event) => {
      console.log(`[LINE Webhook] Event Type: ${event.type}`);

      if (event.type === "message" && event.message.type === "text") {
        const text = (event.message as webhook.TextMessageContent).text.trim();
        const replyToken = event.replyToken;

        console.log(`[LINE Webhook] Text received: "${text}"`);

        if (!replyToken) return;

        if (isDispenseMenuCommand(text)) {
          await replyDispenseMenu(replyToken);
          return;
        }

        if (text.toLowerCase() === "order") {
          await replyOrderingMenu(replyToken);
          return;
        }

        if (text.toLowerCase() === "help" || text === "เมนู") {
          await replyHelp(replyToken);
          return;
        }

        if (text.toLowerCase() === "id" || text === "ลงทะเบียน") {
          const userId = event.source?.userId;
          if (!userId) return;

          await sendReply(replyToken, {
            type: "text",
            text: `LINE User ID ของคุณคือ:\n${userId}\n\nกรุณาคัดลอกไปวางในเมนู "ตั้งค่าการแจ้งเตือน" ในระบบ LabStock เพื่อเปิดรับการแจ้งเตือนค่ะ`,
          });
          return;
        }

        const stockCommand = parseStockCommand(text);
        if (stockCommand) {
          if (stockCommand.keyword) {
            const stockRows = stockCommand.searchByJob
              ? await searchStockRowsByJob(stockCommand.keyword)
              : await searchStockRows(stockCommand.keyword, 10);
            await replyStockSummary(
              replyToken,
              stockCommand.searchByJob
                ? `สต๊อกงาน "${stockCommand.keyword}" ทั้งหมด ${stockRows.length} รายการ`
                : `ผลค้นหาสต๊อกสำหรับ "${stockCommand.keyword}"`,
              stockRows,
            );
          } else {
            const lowStockData = await getLowStockRows(10);

            if (lowStockData.length > 0) {
              await replyLowStock(replyToken, lowStockData as LowStockItem[]);
            } else {
              await sendReply(replyToken, {
                type: "text",
                text: "ขณะนี้ไม่มีรายการน้ำยาที่ต่ำกว่าระดับ Min Stock ค่ะ",
              });
            }
          }
          return;
        }

        if (text.toUpperCase().startsWith("PO-")) {
          const poNumber = text.toUpperCase();
          const poData = await sql`SELECT * FROM purchase_orders WHERE po_number = ${poNumber}`;

          if (poData.length > 0) {
            const poRow = poData[0] as PurchaseOrderRow;
            const itemsDataRows = await sql`
              SELECT item_name, quantity, unit
              FROM purchase_order_items
              WHERE po_id = ${poRow.id}
            `;
            const itemsData: PurchaseOrderItem[] = itemsDataRows.map((item) => ({
              item_name: String(item.item_name ?? ""),
              quantity: Number(item.quantity ?? 0),
              unit: String(item.unit ?? ""),
            }));
            const po: PurchaseOrder = {
              id: poRow.id,
              po_number: String(poRow.po_number),
              vendor: String(poRow.vendor),
              status: String(poRow.status),
              expected_date: poRow.expected_date ?? null,
              items: itemsData,
            };
            await replyPODetail(replyToken, po);
          } else {
            await sendReply(replyToken, {
              type: "text",
              text: `ไม่พบใบสั่งซื้อหมายเลข ${poNumber} ในระบบค่ะ`,
            });
          }
          return;
        }

        if (/^[A-Z]{2}[0-9]{9}[A-Z]{2}$/.test(text)) {
          const shipments = await sql`SELECT * FROM shipments WHERE tracking_no = ${text}`;

          if (shipments.length > 0) {
            const tracking: TrackingResult = {
              provider: shipments[0].tracking_provider || "Unknown",
              trackingNo: text,
              status: shipments[0].tracking_status || "UNKNOWN",
              statusText: "พัสดุอยู่ในระบบ",
              lastUpdate: new Date().toISOString(),
              history: [],
            };
            await replyTrackingStatus(replyToken, tracking);
          } else {
            await sendReply(replyToken, {
              type: "text",
              text: `ไม่พบข้อมูลพัสดุ ${text} ในระบบค่ะ`,
            });
          }
          return;
        }

        if (text === "สั่งซื้อ" || text.toLowerCase() === "order") {
          await sendReply(replyToken, {
            type: "text",
            text: `กรุณาเข้าสู่ระบบเพื่อสร้างใบสั่งซื้อ: ${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/orders`,
          });
          return;
        }

        await replyHelp(replyToken);
        return;
      }

      if (event.type === "postback") {
        const postbackEvent = event as webhook.PostbackEvent;
        const data = new URLSearchParams(postbackEvent.postback.data);
        const action = data.get("action");
        const id = data.get("id");
        const replyToken = postbackEvent.replyToken;

        if (!replyToken) return;

        if (action === "confirm_po" && id) {
          await sql`UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = NOW() WHERE po_number = ${id}`;
          await sendReply(replyToken, {
            type: "text",
            text: `ยืนยันใบสั่งซื้อ ${id} เรียบร้อยแล้ว ระบบได้แจ้งเตือนให้ Lab ทราบแล้วค่ะ`,
          });
          return;
        }

        if (action === "reject_po" && id) {
          await sql`UPDATE purchase_orders SET status = 'REJECTED' WHERE po_number = ${id}`;
          await sendReply(replyToken, {
            type: "text",
            text: `ปฏิเสธใบสั่งซื้อ ${id} เรียบร้อยแล้วค่ะ`,
          });
          return;
        }

        if (action === "ack_expiry") {
          const itemId = data.get("itemId");
          const lotNo = data.get("lotNo");
          const expDate = data.get("expDate");
          const lineUserId = postbackEvent.source?.userId || null;

          if (!itemId || !lotNo || !expDate) return;

          await ensureExpiryAcknowledgementSchema();
          await sql`
            UPDATE expiry_notification_logs
            SET acknowledged_at = COALESCE(acknowledged_at, NOW()),
                acknowledged_by_line_user_id = COALESCE(acknowledged_by_line_user_id, ${lineUserId})
            WHERE item_id = ${itemId}
              AND lot_no = ${lotNo}
              AND exp_date = ${expDate}::date
              AND notification_type = ${expiryNotificationType}
          `;

          await sendReply(replyToken, {
            type: "text",
            text: `รับทราบน้ำยา Lot ${lotNo} เรียบร้อยแล้ว`,
          });
        }
      }
    }));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Webhook processing error:", error);
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
