import type { LowStockItem } from "./line-flex-templates";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_MAX_TEXT_LENGTH = 4000;

const getBotToken = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "";

const normalizeChatIds = (value: string | undefined) => {
  return (value || "")
    .split(",")
    .map((chatId) => chatId.trim())
    .filter(Boolean);
};

export const getTelegramAlertChatIds = () => {
  return normalizeChatIds(process.env.TELEGRAM_ALERT_CHAT_IDS);
};

export const getTelegramAllowedChatIds = () => {
  const explicit = normalizeChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  return explicit.length > 0 ? explicit : getTelegramAlertChatIds();
};

export const isTelegramConfigured = () => {
  return Boolean(getBotToken() && getTelegramAlertChatIds().length > 0);
};

const chunkTelegramText = (text: string, maxLength = TELEGRAM_MAX_TEXT_LENGTH) => {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength * 0.5) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
};

async function callTelegram(method: string, payload: Record<string, unknown>) {
  const botToken = getBotToken();
  if (!botToken) {
    console.warn("[Telegram] TELEGRAM_BOT_TOKEN is not set, skipping request.");
    return;
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API ${method} failed: ${response.status} ${body}`);
  }
}

export async function sendTelegramMessage(chatId: string, text: string) {
  const chunks = chunkTelegramText(text);

  for (const chunk of chunks) {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}

export async function sendTelegramBroadcast(text: string, chatIds = getTelegramAlertChatIds()) {
  if (chatIds.length === 0) {
    console.warn("[Telegram] No TELEGRAM_ALERT_CHAT_IDS configured, skipping broadcast.");
    return;
  }

  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(chatId, text);
    } catch (error) {
      console.error(`[Telegram] Failed to send message to chat ${chatId}:`, error);
    }
  }
}

export function formatLowStockTelegramDigest(items: LowStockItem[]) {
  const header = `<b>LabStock Low Stock Alert</b>\nItems below minimum: ${items.length}`;
  const lines = items.slice(0, 10).map((item) => {
    return `- ${item.name} (${item.itemId}): ${item.quantity} ${item.unit} | Min ${item.minThreshold}`;
  });
  const moreLine = items.length > 10 ? `\n...and ${items.length - 10} more item(s)` : "";
  return `${header}\n${lines.join("\n")}${moreLine}`;
}

type TransactionDigestInput = {
  actor: string;
  action: "receive" | "dispense";
  items: Array<{
    itemId: string;
    lotNo: string;
    qty: number;
    name?: string;
  }>;
};

export function formatTransactionTelegramDigest(data: TransactionDigestInput) {
  const title = data.action === "receive" ? "Stock Receive" : "Stock Dispense";
  const totalQty = data.items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const lines = data.items.slice(0, 10).map((item) => {
    const label = item.name?.trim() || item.itemId;
    return `- ${label} | ${item.itemId} | Lot ${item.lotNo} | Qty ${item.qty}`;
  });
  const moreLine = data.items.length > 10 ? `\n...and ${data.items.length - 10} more item(s)` : "";

  return [
    `<b>LabStock ${title}</b>`,
    `By: ${data.actor}`,
    `Items: ${data.items.length}`,
    `Total Qty: ${totalQty}`,
    lines.join("\n") + moreLine,
  ]
    .filter(Boolean)
    .join("\n");
}

type LogDigestEntry = {
  timestamp: string;
  action: string;
  itemId: string;
  name: string;
  lotNo: string;
  qty: number;
  user: string;
};

export function formatRecentLogsTelegramDigest(logs: LogDigestEntry[]) {
  if (logs.length === 0) {
    return "<b>LabStock Recent Logs</b>\nNo recent log entries found.";
  }

  const lines = logs.map((log) => {
    const stamp = new Date(log.timestamp).toLocaleString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Bangkok",
    });

    return `- ${stamp} | ${log.action} | ${log.name} (${log.itemId}) | Lot ${log.lotNo} | Qty ${log.qty} | ${log.user}`;
  });

  return `<b>LabStock Recent Logs</b>\n${lines.join("\n")}`;
}

type StockSummaryEntry = {
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  minThreshold?: number;
};

export function formatStockTelegramDigest(items: StockSummaryEntry[], title: string) {
  if (items.length === 0) {
    return `<b>${title}</b>\nNo matching stock items found.`;
  }

  const lines = items.map((item) => {
    const minPart =
      typeof item.minThreshold === "number" ? ` | Min ${item.minThreshold}` : "";
    return `- ${item.name} (${item.itemId}): ${item.quantity} ${item.unit}${minPart}`;
  });

  return `<b>${title}</b>\n${lines.join("\n")}`;
}
