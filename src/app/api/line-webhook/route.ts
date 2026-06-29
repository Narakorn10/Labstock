import { NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import {
  replyHelp,
  replyLowStock,
  replyPODetail,
  replyTrackingStatus,
  sendLineReply,
} from "@/lib/line-bot";
import sql from "@/lib/db";
import type { AuthenticatedUser } from "@/lib/auth-utils";
import { runDispenseBatch, type StockBatchItem } from "@/lib/stock-transactions";
import { getLowStockRows, searchStockRows } from "@/lib/bot-stock-queries";
import { getAppBaseUrl } from "@/lib/telegram-bot";
import type {
  LowStockItem,
  PurchaseOrder,
  TrackingResult,
} from "@/lib/line-flex-templates";

const channelSecret = process.env.LINE_CHANNEL_SECRET || "DUMMY_SECRET";
const MAX_LINE_REPLY_MESSAGES = 5;
const MAX_DISPENSE_POSTBACK_DATA_LENGTH = 240;

const isCommand = (text: string, ...commands: string[]) => {
  const normalized = text.trim().toLowerCase();
  return commands.some((command) => normalized === command.toLowerCase());
};

const extractStockSearch = (text: string) => {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("stock ")) return trimmed.slice(6).trim();
  if (lower.startsWith("stock:")) return trimmed.slice(6).trim();
  if (trimmed.startsWith("สต๊อก ")) return trimmed.slice(7).trim();
  if (trimmed.startsWith("สต๊อก:")) return trimmed.slice(7).trim();

  return "";
};

const parseJobTypeCommand = (text: string) => {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const summaryCommands = new Set([
    "job",
    "jobs",
    "stock by job",
    "งาน",
    "ประเภทงาน",
    "สต๊อกตามงาน",
  ]);

  if (summaryCommands.has(lower) || summaryCommands.has(trimmed)) {
    return { matched: true, keyword: "" };
  }

  if (lower.startsWith("job ")) return { matched: true, keyword: trimmed.slice(4).trim() };
  if (lower.startsWith("job:")) return { matched: true, keyword: trimmed.slice(4).trim() };
  if (trimmed.startsWith("งาน ")) return { matched: true, keyword: trimmed.slice(4).trim() };
  if (trimmed.startsWith("งาน:")) return { matched: true, keyword: trimmed.slice(4).trim() };
  if (trimmed.startsWith("ประเภทงาน ")) return { matched: true, keyword: trimmed.slice(9).trim() };
  if (trimmed.startsWith("ประเภทงาน:")) return { matched: true, keyword: trimmed.slice(9).trim() };

  return { matched: false, keyword: "" };
};

const parseDispenseCommand = (text: string) => {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const parts = trimmed.split(/\s+/).filter(Boolean);

  if (parts.length < 3) {
    return { matched: lower === "dispense" || trimmed === "เบิก", itemId: "", quantity: NaN };
  }

  if (parts[0].toLowerCase() !== "dispense" && parts[0] !== "เบิก") {
    return { matched: false, itemId: "", quantity: NaN };
  }

  return {
    matched: true,
    itemId: parts[1],
    quantity: Number(parts[2]),
  };
};

const fallbackLabel = (value: string | null | undefined, emptyLabel: string) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || emptyLabel;
};

const chunkLines = (header: string, lines: string[], maxLength = 4200) => {
  if (lines.length === 0) return [header];

  const messages: string[] = [];
  let current = header;

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      messages.push(current);
      current = `${header}\n${line}`;
      continue;
    }

    current = next;
  }

  if (current) {
    messages.push(current);
  }

  return messages;
};

function limitReplyMessages(messages: string[]) {
  if (messages.length <= MAX_LINE_REPLY_MESSAGES) {
    return messages;
  }

  const visible = messages.slice(0, MAX_LINE_REPLY_MESSAGES);
  const hiddenCount = messages.length - visible.length;
  visible[visible.length - 1] = `${visible[visible.length - 1]}\n\n...truncated ${hiddenCount} more message(s). Narrow the search to see the rest.`;
  return visible;
}

async function replyText(replyToken: string, text: string) {
  await sendLineReply(replyToken, [{ type: "text", text }]);
}

async function replyTextChunks(replyToken: string, header: string, lines: string[]) {
  const texts = limitReplyMessages(chunkLines(header, lines));
  await sendLineReply(
    replyToken,
    texts.map((text) => ({ type: "text", text })),
  );
}

function serializeDispenseBatch(batchItems: StockBatchItem[]) {
  return batchItems
    .map((item) => `${encodeURIComponent(item.lotNo)}~${item.qty}`)
    .join(",");
}

function parseDispenseBatch(itemId: string, serializedBatch: string): StockBatchItem[] {
  if (!serializedBatch.trim()) {
    throw new Error("Dispense batch is empty.");
  }

  return serializedBatch.split(",").map((entry) => {
    const [encodedLotNo, qtyText] = entry.split("~");
    const lotNo = decodeURIComponent(encodedLotNo || "");
    const qty = Number(qtyText);

    if (!lotNo || !Number.isFinite(qty) || qty <= 0) {
      throw new Error("Dispense batch data is invalid.");
    }

    return {
      itemId,
      lotNo,
      qty,
    };
  });
}

function createDispensePostbackData(itemId: string, batchItems: StockBatchItem[]) {
  const params = new URLSearchParams({
    action: "confirm_dispense",
    itemId,
    batch: serializeDispenseBatch(batchItems),
  });

  const data = params.toString();
  if (data.length > MAX_DISPENSE_POSTBACK_DATA_LENGTH) {
    throw new Error("This dispense request spans too many lots for LINE confirm. Please use the web app for this item.");
  }

  return data;
}

function createDispenseConfirmMessage(itemId: string, quantity: number, previewLines: string[], batchItems: StockBatchItem[]) {
  const postbackData = createDispensePostbackData(itemId, batchItems);

  return {
    type: "flex",
    altText: `Confirm dispense ${itemId}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#DC2626",
        contents: [
          {
            type: "text",
            text: "DISPENSE CONFIRM",
            color: "#FFFFFF",
            weight: "bold",
            size: "sm",
          },
          {
            type: "text",
            text: `${itemId} x ${quantity}`,
            color: "#FFFFFF",
            weight: "bold",
            size: "xl",
            margin: "md",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: previewLines.map((line) => ({
          type: "text",
          text: line,
          wrap: true,
          size: "sm",
          color: "#111827",
        })),
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#DC2626",
            action: {
              type: "postback",
              label: "Confirm Dispense",
              data: postbackData,
            },
          },
          {
            type: "button",
            style: "secondary",
            action: {
              type: "message",
              label: "Cancel",
              text: "help",
            },
          },
        ],
      },
    },
  };
}

function getReplyToken(event: webhook.Event) {
  if ("replyToken" in event && typeof event.replyToken === "string") {
    return event.replyToken;
  }

  return "";
}

const followReplyText = [
  "ยินดีต้อนรับสู่ LabStock LINE",
  "",
  'พิมพ์ "id" เพื่อดู LINE User ID',
  'พิมพ์ "help" เพื่อดูคำสั่งทั้งหมด',
  'พิมพ์ "stock <keyword>" เพื่อค้นหาสต๊อก',
].join("\n");

const groupJoinReplyText = [
  "LabStock bot joined this chat.",
  "",
  'ใช้คำสั่ง "help", "stock", "job", "PO-xxxx" และเลขพัสดุได้ในกลุ่ม',
  'ถ้าต้องการลงทะเบียน LINE User ID ให้แชท 1:1 แล้วพิมพ์ "id"',
].join("\n");

const memberJoinReplyText = [
  "ยินดีต้อนรับสู่ LabStock",
  "",
  'พิมพ์ "help" เพื่อดูคำสั่ง',
  'ถ้าต้องการลงทะเบียน LINE User ID ให้แชท 1:1 แล้วพิมพ์ "id"',
].join("\n");

async function getLineBoundUser(lineUserId: string | undefined): Promise<AuthenticatedUser | null> {
  if (!lineUserId) return null;

  const rows = await sql`
    SELECT u.username, u.name, u.role, u.vendor
    FROM notification_settings n
    JOIN users u ON LOWER(u.username) = LOWER(n.username)
    WHERE n.line_user_id = ${lineUserId}
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  return {
    username: rows[0].username,
    name: rows[0].name,
    role: rows[0].role,
    vendor: rows[0].vendor || undefined,
  };
}

async function getMasterDisplay(itemId: string) {
  const rows = await sql`
    SELECT item_id as "itemId", name, unit
    FROM master_data
    WHERE LOWER(item_id) = LOWER(${itemId})
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      itemId,
      displayName: itemId,
      unit: "",
    };
  }

  return {
    itemId: rows[0].itemId,
    displayName: rows[0].name || itemId,
    unit: rows[0].unit || "",
  };
}

async function buildDispensePlan(itemId: string, quantity: number) {
  const targetQty = Number(quantity);
  if (!Number.isFinite(targetQty) || targetQty <= 0) {
    throw new Error("Quantity must be greater than 0.");
  }

  const rows = await sql`
    SELECT
      m.item_id as "itemId",
      m.name,
      m.unit,
      i.lot_no as "lotNo",
      i.exp_date as "expDate",
      i.quantity
    FROM master_data m
    LEFT JOIN inventory i ON LOWER(m.item_id) = LOWER(i.item_id)
    WHERE LOWER(m.item_id) = LOWER(${itemId})
      AND COALESCE(i.quantity, 0) > 0
    ORDER BY i.exp_date ASC NULLS LAST, i.lot_no ASC
  `;

  if (rows.length === 0) {
    throw new Error(`Item ${itemId} was not found in available inventory.`);
  }

  const displayName = rows[0].name || itemId;
  const unit = rows[0].unit || "";
  let remaining = targetQty;
  const batchItems: StockBatchItem[] = [];
  const previewLines = [`${displayName}`, `Requested: ${targetQty} ${unit}`];

  for (const row of rows) {
    if (remaining <= 0) break;

    const availableQty = Number(row.quantity || 0);
    if (availableQty <= 0) continue;

    const takeQty = Math.min(availableQty, remaining);
    batchItems.push({
      itemId: row.itemId,
      lotNo: row.lotNo,
      qty: takeQty,
      name: displayName,
      expDate: row.expDate,
    });

    const expDate = row.expDate ? new Date(row.expDate).toLocaleDateString("th-TH") : "-";
    previewLines.push(`Lot ${row.lotNo}: ${takeQty}/${availableQty} ${unit} (EXP ${expDate})`);
    remaining -= takeQty;
  }

  const totalAvailable = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  if (remaining > 0) {
    throw new Error(`Insufficient stock for ${itemId}. Requested ${targetQty} ${unit}, available ${totalAvailable} ${unit}.`);
  }

  return {
    itemId: rows[0].itemId,
    displayName,
    unit,
    requestedQty: targetQty,
    batchItems,
    previewLines,
  };
}

async function replyStockSearch(replyToken: string, keyword: string) {
  const rows = await searchStockRows(keyword, 5);

  if (rows.length === 0) {
    await replyText(replyToken, `ไม่พบรายการสต๊อกที่ตรงกับ "${keyword}"`);
    return;
  }

  const lines = rows.map((row) => {
    const quantity = Number(row.quantity || 0);
    const unit = row.unit || "";
    const jobType = fallbackLabel(String(row.jobType || ""), "Unassigned job");
    const machineType = fallbackLabel(String(row.machineType || ""), "Unassigned machine");

    return [
      `${row.name} (${row.itemId})`,
      `Job/Machine: ${jobType} / ${machineType}`,
      `Stock: ${quantity} ${unit}`,
      "",
    ].join("\n");
  });

  await replyTextChunks(replyToken, `ผลค้นหาสต๊อก "${keyword}"`, lines);
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
        COALESCE(NULLIF(m.job_type, ''), 'Unassigned job') as "jobType",
        COALESCE(NULLIF(m.machine_type, ''), 'Unassigned machine') as "machineType",
        COUNT(*)::int as "itemCount",
        COALESCE(SUM(COALESCE(i.current_qty, 0)), 0)::float as "totalQty",
        SUM(CASE WHEN COALESCE(i.current_qty, 0) <= m.min_threshold THEN 1 ELSE 0 END)::int as "lowStockCount"
      FROM master_data m
      LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
      GROUP BY
        COALESCE(NULLIF(m.job_type, ''), 'Unassigned job'),
        COALESCE(NULLIF(m.machine_type, ''), 'Unassigned machine')
      ORDER BY
        COALESCE(NULLIF(m.job_type, ''), 'Unassigned job') ASC,
        COALESCE(NULLIF(m.machine_type, ''), 'Unassigned machine') ASC
    `;

    if (rows.length === 0) {
      await replyText(replyToken, "ยังไม่มีข้อมูลน้ำยาในระบบ");
      return;
    }

    const lines: string[] = [];
    let currentJobType = "";

    rows.forEach((row) => {
      const jobType = fallbackLabel(String(row.jobType || ""), "Unassigned job");
      const machineType = fallbackLabel(String(row.machineType || ""), "Unassigned machine");
      const itemCount = Number(row.itemCount || 0);
      const totalQty = Number(row.totalQty || 0);
      const lowStockCount = Number(row.lowStockCount || 0);

      if (jobType !== currentJobType) {
        if (lines.length > 0) lines.push("");
        lines.push(`[${jobType}]`);
        currentJobType = jobType;
      }

      lines.push(`- ${machineType}: ${itemCount} items, total ${totalQty}, low ${lowStockCount}`);
    });

    await replyTextChunks(replyToken, "สรุปสต๊อกตามประเภทงานและเครื่อง", lines);
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
      COALESCE(NULLIF(m.job_type, ''), 'Unassigned job') as "jobType",
      COALESCE(NULLIF(m.machine_type, ''), 'Unassigned machine') as "machineType",
      m.unit,
      COALESCE(i.current_qty, 0) as quantity
    FROM master_data m
    LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
    WHERE COALESCE(NULLIF(m.job_type, ''), 'Unassigned job') ILIKE ${likeKeyword}
    ORDER BY m.item_id ASC
    LIMIT 10
  `;

  if (rows.length === 0) {
    await replyText(replyToken, `ไม่พบประเภทงาน "${keyword}"`);
    return;
  }

  const lines = rows.map((row) => {
    const quantity = Number(row.quantity || 0);
    const unit = row.unit || "";
    const machineType = fallbackLabel(String(row.machineType || ""), "Unassigned machine");

    return `${row.name} (${row.itemId})\nMachine: ${machineType}\nStock: ${quantity} ${unit}\n`;
  });

  await replyTextChunks(replyToken, `น้ำยาในประเภทงาน "${rows[0].jobType}"`, lines);
}

async function replyLowStockSummary(replyToken: string) {
  const lowStockData = await getLowStockRows(10);

  if (lowStockData.length > 0) {
    await replyLowStock(replyToken, lowStockData as unknown as LowStockItem[]);
    return;
  }

  await replyText(replyToken, "ตอนนี้ยังไม่มีรายการต่ำกว่า Min Stock");
}

export async function POST(req: Request) {
  try {
    const bodyText = await req.text();
    const signature = req.headers.get("x-line-signature") || "";

    console.log("[LINE Webhook] Received event");

    if (process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_SECRET !== "DUMMY_SECRET") {
      if (!validateSignature(bodyText, channelSecret, signature)) {
        console.error("[LINE Webhook] Invalid signature. Check your LINE_CHANNEL_SECRET.");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const body = JSON.parse(bodyText) as { events?: webhook.Event[] };
    const events = Array.isArray(body.events) ? body.events : [];

    console.log(`[LINE Webhook] Processing ${events.length} events`);

    await Promise.all(
      events.map(async (event) => {
        console.log(`[LINE Webhook] Event Type: ${event.type}`);

        if (event.type === "message" && event.message.type === "text") {
          const text = (event.message as webhook.TextMessageContent).text.trim();
          const replyToken = getReplyToken(event);

          console.log(`[LINE Webhook] Text received: "${text}"`);

          if (!replyToken) return;

          const stockSearch = extractStockSearch(text);
          const jobTypeCommand = parseJobTypeCommand(text);
          const dispenseCommand = parseDispenseCommand(text);

          if (isCommand(text, "help", "เมนู")) {
            await replyHelp(replyToken);
          } else if (isCommand(text, "id", "ลงทะเบียน")) {
            const userId = event.source?.userId;
            if (!userId) return;

            await replyText(
              replyToken,
              `LINE User ID ของคุณคือ:\n${userId}\n\nคัดลอกไปใส่ในเมนูตั้งค่าการแจ้งเตือนของ LabStock ได้เลย`,
            );
          } else if (jobTypeCommand.matched) {
            await replyJobTypeStock(replyToken, jobTypeCommand.keyword);
          } else if (dispenseCommand.matched) {
            const lineUser = await getLineBoundUser(event.source?.userId);
            if (!lineUser) {
              await replyText(replyToken, "ยังไม่พบ LINE User ID นี้ในระบบ กรุณาลงทะเบียนในเมนูตั้งค่าการแจ้งเตือนก่อน");
              return;
            }

            if (lineUser.role === "Vendor") {
              await replyText(replyToken, "บัญชี Vendor ไม่สามารถเบิกผ่าน LINE ได้");
              return;
            }

            if (!dispenseCommand.itemId || !Number.isFinite(dispenseCommand.quantity) || dispenseCommand.quantity <= 0) {
              await replyText(replyToken, "รูปแบบคำสั่งไม่ถูกต้อง ใช้: dispense <itemId> <qty>");
              return;
            }

            try {
              const plan = await buildDispensePlan(dispenseCommand.itemId, dispenseCommand.quantity);
              await sendLineReply(replyToken, [
                createDispenseConfirmMessage(plan.itemId, plan.requestedQty, plan.previewLines, plan.batchItems),
              ]);
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              await replyText(replyToken, message);
            }
          } else if (stockSearch) {
            await replyStockSearch(replyToken, stockSearch);
          } else if (isCommand(text, "stock", "สต๊อก")) {
            await replyLowStockSummary(replyToken);
          } else if (text.toUpperCase().startsWith("PO-")) {
            const poNumber = text.toUpperCase();
            const poData = await sql`SELECT * FROM purchase_orders WHERE po_number = ${poNumber}`;
            if (poData.length > 0) {
              const itemsData = await sql`
                SELECT item_name, quantity, unit
                FROM purchase_order_items
                WHERE po_id = ${poData[0].id}
              `;
              const po = { ...poData[0], items: itemsData } as unknown as PurchaseOrder;
              await replyPODetail(replyToken, po);
            } else {
              await replyText(replyToken, `ไม่พบใบสั่งซื้อ ${poNumber}`);
            }
          } else if (text.match(/^[A-Z]{2}[0-9]{9}[A-Z]{2}$/)) {
            const shipments = await sql`SELECT * FROM shipments WHERE tracking_no = ${text}`;
            if (shipments.length > 0) {
              const tracking: TrackingResult = {
                provider: shipments[0].tracking_provider || "Unknown",
                trackingNo: text,
                status: shipments[0].tracking_status || "UNKNOWN",
                statusText: "พบข้อมูลพัสดุในระบบ",
                lastUpdate: new Date().toISOString(),
                history: [],
              };
              await replyTrackingStatus(replyToken, tracking);
            } else {
              await replyText(replyToken, `ไม่พบข้อมูลพัสดุ ${text}`);
            }
          } else if (isCommand(text, "order", "สั่งซื้อ")) {
            await replyText(
              replyToken,
              `เปิดหน้าสร้างใบสั่งซื้อได้ที่ ${getAppBaseUrl()}/orders`,
            );
          } else {
            await replyHelp(replyToken);
          }
          return;
        }

        if (event.type === "follow") {
          const replyToken = getReplyToken(event);
          if (!replyToken) return;
          await replyText(replyToken, followReplyText);
          return;
        }

        if (event.type === "join") {
          const replyToken = getReplyToken(event);
          if (!replyToken) return;
          await replyText(replyToken, groupJoinReplyText);
          return;
        }

        if (event.type === "memberJoined") {
          const replyToken = getReplyToken(event);
          if (!replyToken) return;
          await replyText(replyToken, memberJoinReplyText);
          return;
        }

        if (event.type === "postback") {
          const postbackEvent = event as webhook.PostbackEvent;
          const data = new URLSearchParams(postbackEvent.postback.data);
          const action = data.get("action");
          const id = data.get("id");
          const itemId = data.get("itemId");
          const batch = data.get("batch");
          const replyToken = getReplyToken(event);

          if (!replyToken) return;

          if (action === "confirm_po" && id) {
            await sql`
              UPDATE purchase_orders
              SET status = 'CONFIRMED', confirmed_at = NOW()
              WHERE po_number = ${id}
            `;
            await replyText(replyToken, `ยืนยันใบสั่งซื้อ ${id} เรียบร้อยแล้ว`);
          } else if (action === "reject_po" && id) {
            await sql`
              UPDATE purchase_orders
              SET status = 'REJECTED'
              WHERE po_number = ${id}
            `;
            await replyText(replyToken, `ปฏิเสธใบสั่งซื้อ ${id} เรียบร้อยแล้ว`);
          } else if (action === "confirm_dispense" && itemId && batch) {
            const lineUser = await getLineBoundUser(event.source?.userId);
            if (!lineUser) {
              await replyText(replyToken, "ไม่พบผู้ใช้ที่ผูกกับ LINE นี้แล้ว กรุณาตรวจสอบการตั้งค่า");
              return;
            }

            if (lineUser.role === "Vendor") {
              await replyText(replyToken, "บัญชี Vendor ไม่สามารถเบิกผ่าน LINE ได้");
              return;
            }

            try {
              const batchItems = parseDispenseBatch(itemId, batch);
              const requestedQty = batchItems.reduce((sum, item) => sum + item.qty, 0);
              const result = await runDispenseBatch(batchItems, lineUser, {
                userAgent: "LINE Bot",
                ipAddress: "LINE Webhook",
              });
              const display = await getMasterDisplay(itemId);

              await replyText(
                replyToken,
                `${result.message}\n${display.displayName} (${display.itemId})\nจำนวน ${requestedQty} ${display.unit}`,
              );
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              await replyText(replyToken, `Dispense failed: ${message}`);
            }
          }
        }
      }),
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Webhook processing error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
