import { NextResponse } from "next/server";
import sql from "@/lib/db";
import {
  formatRecentLogsTelegramDigest,
  formatStockTelegramDigest,
  getTelegramAllowedChatIds,
  sendTelegramMessage,
} from "@/lib/telegram-bot";

const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";

const isAuthorizedChat = (chatId: string) => {
  const allowedChatIds = getTelegramAllowedChatIds();
  return allowedChatIds.length > 0 && allowedChatIds.includes(chatId);
};

const parseLogsLimit = (text: string) => {
  const match = text.trim().match(/^\/logs(?:@\w+)?(?:\s+(\d+))?$/i);
  if (!match) return null;

  const requested = Number(match[1] || 10);
  if (Number.isNaN(requested)) return 10;
  return Math.min(Math.max(requested, 1), 20);
};

const parseTransactionsLimit = (text: string) => {
  const match = text.trim().match(/^\/transactions(?:@\w+)?(?:\s+(\d+))?$/i);
  if (!match) return null;

  const requested = Number(match[1] || 10);
  if (Number.isNaN(requested)) return 10;
  return Math.min(Math.max(requested, 1), 20);
};

const parseStockKeyword = (text: string) => {
  const match = text.trim().match(/^\/stock(?:@\w+)?(?:\s+(.+))?$/i);
  if (!match) return null;

  return (match[1] || "").trim();
};

const helpText = [
  "<b>LabStock Telegram Bot</b>",
  "Available commands:",
  "/help - show this help",
  "/logs - show the latest 10 log entries",
  "/logs 20 - show up to 20 recent log entries",
  "/transactions - show the latest 10 transaction logs",
  "/stock - show low-stock items",
  "/stock <keyword> - search stock by item ID, name, or barcode",
  "/dispense - open the LabStock dispense page",
  "/receive - open the LabStock receive page",
].join("\n");

type TelegramLogRow = {
  timestamp: string;
  action: string;
  itemId: string;
  name: string;
  lotNo: string;
  qty: number;
  user: string;
};

type TelegramStockRow = {
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  minThreshold?: number;
};

async function sendTransactions(chatId: string, limit: number) {
  const logs = await sql`
    SELECT
      timestamp,
      action,
      item_id as "itemId",
      name,
      lot_no as "lotNo",
      quantity as qty,
      username as user
    FROM logs
    ORDER BY timestamp DESC, id DESC
    LIMIT ${limit}
  `;

  await sendTelegramMessage(chatId, formatRecentLogsTelegramDigest(logs as TelegramLogRow[]));
}

async function sendLowStock(chatId: string) {
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
    WHERE COALESCE(i.current_qty, 0) <= m.min_threshold
    ORDER BY COALESCE(i.current_qty, 0) ASC, m.item_id ASC
    LIMIT 10
  `;

  await sendTelegramMessage(
    chatId,
    formatStockTelegramDigest(rows as TelegramStockRow[], "LabStock Low Stock"),
  );
}

async function sendStockSearch(chatId: string, keyword: string) {
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
      COALESCE(i.current_qty, 0) as quantity
    FROM master_data m
    LEFT JOIN InventorySummary i ON LOWER(m.item_id) = LOWER(i.item_id)
    WHERE m.item_id ILIKE ${likeKeyword}
       OR m.name ILIKE ${likeKeyword}
       OR COALESCE(m.barcode, '') ILIKE ${likeKeyword}
    ORDER BY m.item_id ASC
    LIMIT 10
  `;

  await sendTelegramMessage(
    chatId,
    formatStockTelegramDigest(rows as TelegramStockRow[], `LabStock Stock Search: ${keyword}`),
  );
}

export async function POST(request: Request) {
  try {
    if (webhookSecret) {
      const secretHeader = request.headers.get("x-telegram-bot-api-secret-token") || "";
      if (secretHeader !== webhookSecret) {
        return NextResponse.json({ error: "Invalid Telegram secret token." }, { status: 401 });
      }
    }

    const body = await request.json();
    const message = body?.message;
    const text = typeof message?.text === "string" ? message.text.trim() : "";
    const chatId = message?.chat?.id ? String(message.chat.id) : "";

    if (!text || !chatId) {
      return NextResponse.json({ ok: true });
    }

    if (!isAuthorizedChat(chatId)) {
      await sendTelegramMessage(chatId, "This chat is not allowed to use LabStock Telegram commands.");
      return NextResponse.json({ ok: true });
    }

    if (/^\/start(?:@\w+)?$/i.test(text) || /^\/help(?:@\w+)?$/i.test(text)) {
      await sendTelegramMessage(chatId, helpText);
      return NextResponse.json({ ok: true });
    }

    const stockKeyword = parseStockKeyword(text);
    if (stockKeyword !== null) {
      if (stockKeyword) {
        await sendStockSearch(chatId, stockKeyword);
      } else {
        await sendLowStock(chatId);
      }
      return NextResponse.json({ ok: true });
    }

    const logsLimit = parseLogsLimit(text);
    if (logsLimit !== null) {
      await sendTransactions(chatId, logsLimit);
      return NextResponse.json({ ok: true });
    }

    const transactionsLimit = parseTransactionsLimit(text);
    if (transactionsLimit !== null) {
      await sendTransactions(chatId, transactionsLimit);
      return NextResponse.json({ ok: true });
    }

    if (/^\/dispense(?:@\w+)?$/i.test(text)) {
      await sendTelegramMessage(
        chatId,
        `Open LabStock dispense here:\n${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dispense`,
      );
      return NextResponse.json({ ok: true });
    }

    if (/^\/receive(?:@\w+)?$/i.test(text)) {
      await sendTelegramMessage(
        chatId,
        `Open LabStock receive here:\n${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/receive`,
      );
      return NextResponse.json({ ok: true });
    }

    await sendTelegramMessage(chatId, helpText);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[Telegram Webhook] Error:", error);
    const message = error instanceof Error ? error.message : "Telegram webhook failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
