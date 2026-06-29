import { NextResponse } from "next/server";
import {
  getTelegramAlertChatIds,
  getTelegramAllowedChatIds,
  isTelegramConfigured,
} from "@/lib/telegram-bot";

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";

  return NextResponse.json({
    configured: isTelegramConfigured(),
    hasBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    hasWebhookSecret: Boolean(webhookSecret),
    alertChatCount: getTelegramAlertChatIds().length,
    allowedChatCount: getTelegramAllowedChatIds().length,
    webhookUrl: appUrl ? `${appUrl}/api/telegram-webhook` : "",
  });
}
