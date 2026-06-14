import nodemailer from 'nodemailer';
import { PurchaseOrder, TrackingResult, LowStockItem } from './line-flex-templates';

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

export type NotifyEvent = 'PO_CREATED' | 'PO_CONFIRMED' | 'PO_SHIPPED' | 'PO_RECEIVED' | 'LOW_STOCK';

export async function notifyUsers(event: NotifyEvent, data: any, settings: any[]) {
  for (const setting of settings) {
    let shouldNotify = false;
    switch (event) {
      case 'PO_CREATED':   shouldNotify = setting.notify_po_created;   break;
      case 'PO_CONFIRMED': shouldNotify = setting.notify_po_confirmed; break;
      case 'PO_SHIPPED':   shouldNotify = setting.notify_po_shipped;   break;
      case 'PO_RECEIVED':  shouldNotify = setting.notify_po_received;  break;
      case 'LOW_STOCK':    shouldNotify = setting.notify_low_stock;    break;
    }

    if (!shouldNotify) continue;

    // Send LINE Push — dynamic import to avoid Turbopack static bundling of line-bot.ts
    if (setting.line_user_id) {
      try {
        // All LINE Bot functions are lazily imported so they don't get bundled
        // into API routes that don't directly need them.
        const { pushPONotification, pushLowStockAlert } = await import('./line-bot');
        const { generatePOStatusTemplate } = await import('./line-flex-templates');

        if (event === 'PO_CREATED') {
          await pushPONotification(setting.line_user_id, data as PurchaseOrder);
        } else if (event === 'LOW_STOCK') {
          await pushLowStockAlert(setting.line_user_id, data as LowStockItem[]);
        } else if (data.po_number) {
          // PO_CONFIRMED, PO_SHIPPED, PO_RECEIVED — send status card
          const { messagingApi } = await import('@line/bot-sdk');
          const lineClient = new messagingApi.MessagingApiClient({
            channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'DUMMY_TOKEN',
          });
          const msg = generatePOStatusTemplate(data as PurchaseOrder);
          await lineClient.pushMessage({ to: setting.line_user_id, messages: [msg as any] });
        }
      } catch (err) {
        console.error('LINE notification error:', err);
      }
    }

    // Send Email
    if (setting.email) {
      let subject = '';
      let html = '';

      if (event === 'PO_CREATED') {
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
    }
  }
}
