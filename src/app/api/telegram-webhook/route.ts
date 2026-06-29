import { NextResponse } from "next/server";
import {
  buildTelegramHelpText,
  buildTelegramRouteMessage,
  formatRecentLogsTelegramDigest,
  formatStockTelegramDigest,
  getTelegramAllowedChatIds,
  sendTelegramMessage,
} from "@/lib/telegram-bot";
import {
  getLowStockRows,
  getRecentLogRows,
  searchStockRows,
} from "@/lib/bot-stock-queries";

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

const helpText = buildTelegramHelpText();

async function sendTransactions(chatId: string, limit: number) {
  const logs = await getRecentLogRows(limit);
  await sendTelegramMessage(chatId, formatRecentLogsTelegramDigest(logs));
}

async function sendLowStock(chatId: string) {
  const rows = await getLowStockRows(10);
  await sendTelegramMessage(
    chatId,
    formatStockTelegramDigest(rows, "LabStock Low Stock"),
  );
}

async function sendStockSearch(chatId: string, keyword: string) {
  const rows = await searchStockRows(keyword, 10);
  await sendTelegramMessage(
    chatId,
    formatStockTelegramDigest(rows, `LabStock Stock Search: ${keyword}`),
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
        buildTelegramRouteMessage("/dispense"),
      );
      return NextResponse.json({ ok: true });
    }

    if (/^\/receive(?:@\w+)?$/i.test(text)) {
      await sendTelegramMessage(
        chatId,
        buildTelegramRouteMessage("/receive"),
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
