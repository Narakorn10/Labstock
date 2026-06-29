"use client";

import { startTransition, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  AlertCircle,
  BellRing,
  ExternalLink,
  HelpCircle,
  Loader2,
  Mail,
  MessageSquare,
  Save,
  Send,
  SendHorizonal,
} from "lucide-react";

type NotificationSettings = {
  email?: string;
  line_user_id?: string;
  line_display_name?: string;
  notify_po_created?: boolean;
  notify_po_confirmed?: boolean;
  notify_po_shipped?: boolean;
  notify_po_received?: boolean;
  notify_low_stock?: boolean;
};

type TelegramStatus = {
  configured: boolean;
  hasBotToken: boolean;
  hasWebhookSecret: boolean;
  alertChatCount: number;
  allowedChatCount: number;
  webhookUrl: string;
};

const defaultSettings: NotificationSettings = {
  email: "",
  line_user_id: "",
  line_display_name: "",
  notify_po_created: true,
  notify_po_confirmed: true,
  notify_po_shipped: true,
  notify_po_received: true,
  notify_low_stock: true,
};

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"line" | "email" | "telegram" | null>(null);

  useEffect(() => {
    if (!user?.username) {
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      try {
        const [settingsResult, telegramResult] = await Promise.allSettled([
          fetch(`/api/settings/notifications?username=${user.username}`),
          fetch("/api/settings/notifications/telegram-status"),
        ]);

        if (cancelled) return;

        if (settingsResult.status === "fulfilled" && settingsResult.value.ok) {
          const nextSettings = await settingsResult.value.json();
          if (!cancelled) {
            startTransition(() => {
              setSettings(nextSettings);
            });
          }
        } else if (!cancelled) {
          startTransition(() => {
            setSettings(defaultSettings);
          });
        }

        if (telegramResult.status === "fulfilled" && telegramResult.value.ok) {
          const nextTelegramStatus = await telegramResult.value.json();
          if (!cancelled) {
            startTransition(() => {
              setTelegramStatus(nextTelegramStatus);
            });
          }
        } else if (!cancelled) {
          startTransition(() => {
            setTelegramStatus(null);
          });
        }
      } catch (error) {
        console.error("Failed to load notification settings:", error);
        if (!cancelled) {
          startTransition(() => {
            setSettings(defaultSettings);
            setTelegramStatus(null);
          });
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [user?.username]);

  const handleChange = (field: keyof NotificationSettings, value: string | boolean) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, username: user.username }),
      });

      alert(res.ok ? "Notification settings saved." : "Failed to save notification settings.");
    } catch (error) {
      console.error(error);
      alert("Failed to save notification settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (type: "line" | "email" | "telegram") => {
    if (!user) return;

    const value =
      type === "line" ? settings?.line_user_id || "" : type === "email" ? settings?.email || "" : "";

    if (type !== "telegram" && !value.trim()) {
      return;
    }

    setTesting(type);
    try {
      const res = await fetch("/api/settings/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, value, username: user.username }),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        alert(`Error: ${errorBody.error || "Unable to send test message."}`);
        return;
      }

      if (type === "telegram") {
        alert("Telegram test message sent.");
      } else {
        alert(`${type.toUpperCase()} test message sent.`);
      }
    } catch (error) {
      console.error(error);
      alert("Connection error while sending the test message.");
    } finally {
      setTesting(null);
    }
  };

  if (user && settings === null) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-blue-600" size={40} />
        <p className="font-bold text-gray-500">Loading notification settings...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <AlertCircle className="text-red-500" size={48} />
        <p className="text-xl font-bold text-gray-900">Please sign in first.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 animate-in fade-in pb-12">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-600 p-2 text-white shadow-lg shadow-indigo-200">
            <BellRing size={24} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Notifications</h1>
        </div>
        <p className="ml-12 text-sm text-gray-500">
          Manage Email, LINE, and Telegram notification setup.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="space-y-6">
          <div className="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <Mail className="text-blue-600" size={20} />
              Email Notifications
            </h2>

            <div className="space-y-3">
              <label className="block text-sm font-bold text-gray-700">Email Address</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={settings?.email || ""}
                  onChange={(e) => handleChange("email", e.target.value)}
                  placeholder="example@email.com"
                  className="flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  onClick={() => handleTest("email")}
                  disabled={!settings?.email || testing === "email"}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 text-gray-600 transition-all hover:bg-gray-100 disabled:opacity-30"
                  title="Send test email"
                >
                  {testing === "email" ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <MessageSquare className="text-green-600" size={20} />
              LINE Bot Notification
            </h2>

            <div className="space-y-3">
              <label className="block text-sm font-bold text-gray-700">LINE User ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings?.line_user_id || ""}
                  onChange={(e) => handleChange("line_user_id", e.target.value)}
                  placeholder="U1234567890abcdef..."
                  className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  onClick={() => handleTest("line")}
                  disabled={!settings?.line_user_id || testing === "line"}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 text-green-600 transition-all hover:bg-green-50 disabled:opacity-30"
                  title="Send LINE test"
                >
                  {testing === "line" ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                </button>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-bold text-blue-700">
                  <HelpCircle size={12} />
                  How to get LINE User ID
                </p>
                <p className="text-[10px] leading-relaxed text-blue-600">
                  Add the LabStock LINE bot as a friend, then send <code className="rounded border border-blue-200 bg-white px-1">id</code> to the bot.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <SendHorizonal className="text-sky-600" size={20} />
              Telegram Bot
            </h2>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <StatusCard label="Bot Token" value={telegramStatus?.hasBotToken ? "Configured" : "Missing"} ok={Boolean(telegramStatus?.hasBotToken)} />
              <StatusCard label="Webhook Secret" value={telegramStatus?.hasWebhookSecret ? "Configured" : "Missing"} ok={Boolean(telegramStatus?.hasWebhookSecret)} />
              <StatusCard label="Alert Chats" value={String(telegramStatus?.alertChatCount ?? 0)} ok={Boolean(telegramStatus?.alertChatCount)} />
              <StatusCard label="Allowed Chats" value={String(telegramStatus?.allowedChatCount ?? 0)} ok={Boolean(telegramStatus?.allowedChatCount)} />
            </div>

            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                telegramStatus?.configured
                  ? "border-green-100 bg-green-50 text-green-700"
                  : "border-amber-100 bg-amber-50 text-amber-700"
              }`}
            >
              {telegramStatus?.configured
                ? "Telegram alerts are ready."
                : "Telegram is not fully configured yet. Add the production env values first."}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-700">Webhook URL</label>
              <div className="break-all rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs font-mono text-gray-700">
                {telegramStatus?.webhookUrl || "Set NEXT_PUBLIC_APP_URL to show the webhook URL here."}
              </div>
            </div>

            <div className="space-y-1 rounded-2xl border border-sky-100 bg-sky-50 p-3 text-[11px] text-sky-700">
              <p className="font-bold">Required production env</p>
              <p>`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_IDS`, `TELEGRAM_ALLOWED_CHAT_IDS`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleTest("telegram")}
                disabled={!telegramStatus?.configured || testing === "telegram"}
                className="flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 font-bold text-white transition-all hover:bg-sky-700 disabled:opacity-40"
              >
                {testing === "telegram" ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                Send Telegram Test
              </button>
              <a
                href="https://core.telegram.org/bots/webhooks"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 font-bold text-gray-700 transition-all hover:bg-gray-100"
              >
                <ExternalLink size={16} />
                Webhook Docs
              </a>
            </div>
          </div>
        </div>

        <div className="space-y-6 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <BellRing className="text-orange-500" size={20} />
            Event Preferences
          </h2>

          <div className="space-y-1">
            {[
              { id: "notify_po_created", label: "Purchase order created", sub: "PO Created" },
              { id: "notify_po_confirmed", label: "Vendor confirmed or rejected order", sub: "PO Confirmed/Rejected" },
              { id: "notify_po_shipped", label: "Vendor marked shipment sent", sub: "PO Shipped" },
              { id: "notify_po_received", label: "Lab received stock", sub: "PO Received" },
              { id: "notify_low_stock", label: "Low stock alert", sub: "Low Stock" },
            ].map((item) => (
              <label
                key={item.id}
                className="group flex cursor-pointer items-center gap-4 rounded-2xl p-3 transition-all hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={Boolean(settings?.[item.id as keyof NotificationSettings])}
                  onChange={(e) => handleChange(item.id as keyof NotificationSettings, e.target.checked)}
                  className="h-5 w-5 cursor-pointer rounded-lg accent-indigo-600"
                />
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-800 transition-colors group-hover:text-indigo-600">
                    {item.label}
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                    {item.sub}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-8 py-3 font-bold text-white shadow-lg shadow-indigo-100 transition-all hover:bg-indigo-700 hover:shadow-indigo-200 active:scale-95 disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          Save Notification Settings
        </button>
      </div>
    </div>
  );
}

function StatusCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-gray-500">{label}</p>
      <p className={`font-bold ${ok ? "text-green-600" : "text-red-500"}`}>{value}</p>
    </div>
  );
}
