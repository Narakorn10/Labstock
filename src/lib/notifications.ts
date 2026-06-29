import nodemailer from 'nodemailer';
import { PurchaseOrder, LowStockItem } from './line-flex-templates';
import {
  formatLowStockTelegramDigest,
  formatTransactionTelegramDigest,
  sendTelegramBroadcast,
} from "./telegram-bot";

// For Email (Nodemailer)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.SMTP_USER) {
    console.warn('SMTP_USER not set, skipping email to', to);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"Lab Stock System" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

export type NotifyEvent =
  | 'PO_CREATED'
  | 'PO_CONFIRMED'
  | 'PO_SHIPPED'
  | 'PO_RECEIVED'
  | 'LOW_STOCK'
  | 'STOCK_RECEIVED'
  | 'STOCK_DISPENSED'
  | 'TEST';

type TransactionNotificationData = {
  actor: string;
  items: Array<{
    itemId: string;
    lotNo: string;
    qty: number;
    name?: string;
  }>;
};

type NotificationPayload = PurchaseOrder | LowStockItem[] | TransactionNotificationData | Record<string, unknown>;

type NotificationSetting = {
  username?: string;
  email?: string | null;
  line_user_id?: string | null;
  notify_po_created?: boolean;
  notify_po_confirmed?: boolean;
  notify_po_shipped?: boolean;
  notify_po_received?: boolean;
  notify_low_stock?: boolean;
};

const isTransactionNotificationData = (data: NotificationPayload): data is TransactionNotificationData => {
  return typeof data === "object" && data !== null && "actor" in data && "items" in data;
};

function buildTelegramMessage(event: NotifyEvent, data: NotificationPayload) {
  if (event === "LOW_STOCK") {
    return formatLowStockTelegramDigest(data as LowStockItem[]);
  }

  if (event === "STOCK_RECEIVED" && isTransactionNotificationData(data)) {
    return formatTransactionTelegramDigest({
      actor: data.actor || "Staff",
      action: "receive",
      items: data.items || [],
    });
  }

  if (event === "STOCK_DISPENSED" && isTransactionNotificationData(data)) {
    return formatTransactionTelegramDigest({
      actor: data.actor || "Staff",
      action: "dispense",
      items: data.items || [],
    });
  }

  if (event === "TEST") {
    return "<b>LabStock Telegram Test</b>\nTelegram notification is working.";
  }

  return "";
}

export async function notifyUsers(event: NotifyEvent, data: NotificationPayload, settings: NotificationSetting[]) {
  console.log(`[Notification] Dispatching event: ${event} to ${settings.length} users`);

  const telegramMessage = buildTelegramMessage(event, data);
  if (telegramMessage) {
    try {
      await sendTelegramBroadcast(telegramMessage);
    } catch (err) {
      console.error("[Notification] Telegram broadcast error:", err);
    }
  }
  
  for (const setting of settings) {
    let shouldNotify = false;
    switch (event) {
      case 'PO_CREATED':   shouldNotify = setting.notify_po_created ?? false;   break;
      case 'PO_CONFIRMED': shouldNotify = setting.notify_po_confirmed ?? false; break;
      case 'PO_SHIPPED':   shouldNotify = setting.notify_po_shipped ?? false;   break;
      case 'PO_RECEIVED':  shouldNotify = setting.notify_po_received ?? false;  break;
      case 'LOW_STOCK':    shouldNotify = setting.notify_low_stock ?? false;    break;
      case 'TEST':         shouldNotify = true;                        break;
    }

    if (!shouldNotify) continue;

    // Send LINE Push
    if (setting.line_user_id) {
      try {
        const { pushPONotification, pushLowStockAlert, sendLinePush } = await import('./line-bot');
        const { generatePOStatusTemplate } = await import('./line-flex-templates');

        if (event === 'TEST') {
          await sendLinePush(setting.line_user_id, [{ type: 'text', text: '🔔 นี่คือข้อความทดสอบจากระบบ LabStock ค่ะ! หากคุณเห็นข้อความนี้ แสดงว่าการตั้งค่า LINE User ID ของคุณถูกต้องแล้ว 🎉' }]);
        } else if (event === 'PO_CREATED') {
          await pushPONotification(setting.line_user_id, data as PurchaseOrder);
        } else if (event === 'LOW_STOCK') {
          await pushLowStockAlert(setting.line_user_id, data as LowStockItem[]);
        } else if ("po_number" in data) {
          const msg = generatePOStatusTemplate(data as PurchaseOrder);
          await sendLinePush(setting.line_user_id, [msg]);
        }
      } catch (err) {
        console.error(`[Notification] LINE Error for user ${setting.username}:`, err);
      }
    }

    // Send Email
    if (setting.email) {
      try {
        let subject = '';
        let html = '';

        if (event === 'TEST') {
          subject = 'Test Notification from LabStock';
          html = '<h3>Hello!</h3><p>This is a test email from your Lab Stock System. If you receive this, your email settings are working correctly.</p>';
        } else if (event === 'PO_CREATED') {
          subject = `New Purchase Order: ${(data as PurchaseOrder).po_number}`;
          html = `<h3>A new purchase order has been created</h3><p>PO Number: ${(data as PurchaseOrder).po_number}</p><p>Vendor: ${(data as PurchaseOrder).vendor}</p>`;
        } else if (event === 'PO_CONFIRMED') {
          subject = `PO Confirmed: ${(data as PurchaseOrder).po_number}`;
          html = `<h3>Purchase order confirmed by vendor</h3><p>PO Number: ${(data as PurchaseOrder).po_number}</p>`;
        } else if (event === 'PO_SHIPPED') {
          subject = `PO Shipped: ${(data as PurchaseOrder).po_number}`;
          html = `<h3>Your order has been shipped</h3><p>PO Number: ${(data as PurchaseOrder).po_number}</p>`;
        } else if (event === 'PO_RECEIVED') {
          subject = `PO Received: ${(data as PurchaseOrder).po_number}`;
          html = `<h3>Order received into stock</h3><p>PO Number: ${(data as PurchaseOrder).po_number}</p>`;
        } else if (event === 'LOW_STOCK') {
          subject = `Low Stock Alert`;
          const items = data as LowStockItem[];
          html = `<h3>The following items are low in stock:</h3><ul>${items.map(i => `<li>${i.name}: ${i.quantity} ${i.unit} (Min: ${i.minThreshold})</li>`).join('')}</ul>`;
        } else {
          subject = `PO Status Update: ${(data as PurchaseOrder).po_number || ''}`;
          html = `<h3>Order status updated</h3><p>Status: ${event}</p>`;
        }

        await sendEmail(setting.email, subject, html);
      } catch (err) {
        console.error(`[Notification] Email Error for user ${setting.username}:`, err);
      }
    }
  }
}
