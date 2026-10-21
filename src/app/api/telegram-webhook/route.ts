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
import { departmentsReady } from "@/lib/departments-flag";
import { DepartmentScopeError, type DepartmentScope } from "@/lib/scoped-db";
import { defaultRoomId } from "@/lib/user-rooms";

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

const SCOPE_UNAVAILABLE_TEXT = "ยังใช้คำสั่งนี้ไม่ได้ กรุณาแจ้งผู้ดูแลระบบ";

// Owner policy: Telegram answers for the default room 'CC' only (like a station). Telegram has no user identity (chat ids
// come from an env allow-list), so there is no per-user department. Never mode "all". If the owner later wants every
// department, "all" is the simpler option. Departments off => legacy (SQL unchanged). Fails closed: a missing/inactive CC
// or any error resolving it returns null and the caller answers with a safe message and reads no data.
async function resolveTelegramScope(): Promise<DepartmentScope | null> {
  try {
    if (!(await departmentsReady())) return { mode: "legacy" };
    const departmentId = await defaultRoomId();
    if (departmentId === null) {
      console.error("[Telegram Webhook] departments are ready but the default room CC is missing or inactive.");
      return null;
    }
    return { mode: "one", departmentId };
  } catch (error: unknown) {
    console.error("[Telegram Webhook] could not resolve the department scope:", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}

async function sendTransactions(chatId: string, limit: number) {
  const scope = await resolveTelegramScope();
  if (!scope) {
    await sendTelegramMessage(chatId, SCOPE_UNAVAILABLE_TEXT);
    return;
  }
  const logs = await getRecentLogRows(limit, scope);
  await sendTelegramMessage(chatId, formatRecentLogsTelegramDigest(logs));
}

async function sendLowStock(chatId: string) {
  const scope = await resolveTelegramScope();
  if (!scope) {
    await sendTelegramMessage(chatId, SCOPE_UNAVAILABLE_TEXT);
    return;
  }
  const rows = await getLowStockRows(10, scope);
  await sendTelegramMessage(
    chatId,
    formatStockTelegramDigest(rows, "LabStock Low Stock"),
  );
}

async function sendStockSearch(chatId: string, keyword: string) {
  const scope = await resolveTelegramScope();
  if (!scope) {
    await sendTelegramMessage(chatId, SCOPE_UNAVAILABLE_TEXT);
    return;
  }
  const rows = await searchStockRows(keyword, 10, scope);
  await sendTelegramMessage(
    chatId,
    formatStockTelegramDigest(rows, `LabStock Stock Search: ${keyword}`),
  );
}

export async function POST(request: Request) {
  try {
    // Fail closed: without a configured secret anyone could call this webhook.
    if (!webhookSecret) {
      console.error("[Telegram Webhook] TELEGRAM_WEBHOOK_SECRET is not set; rejecting request.");
      return NextResponse.json({ error: "Telegram webhook is not configured." }, { status: 503 });
    }

    const secretHeader = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (secretHeader !== webhookSecret) {
      return NextResponse.json({ error: "Invalid Telegram secret token." }, { status: 401 });
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
    if (error instanceof DepartmentScopeError) {
      console.error(`[Telegram Webhook] department scope error: ${error.code}`);
      return NextResponse.json({ error: "Telegram webhook failed." }, { status: 500 });
    }
    console.error("[Telegram Webhook] Error:", error);
    const message = error instanceof Error ? error.message : "Telegram webhook failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
