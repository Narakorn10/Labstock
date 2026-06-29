import { NextResponse } from 'next/server';
import { notifyUsers } from '@/lib/notifications';
import { sendTelegramBroadcast } from '@/lib/telegram-bot';

export async function POST(request: Request) {
  try {
    const { type, value, username } = await request.json();

    if (!type || !username) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    if (type === 'telegram') {
      await sendTelegramBroadcast(
        `LabStock Telegram test\nTriggered by: ${username}\nTime: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })}`,
      );

      return NextResponse.json({ success: true });
    }

    if (!value) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Create a temporary settings object for the test
    const testSetting = {
      username,
      email: type === 'email' ? value : null,
      line_user_id: type === 'line' ? value : null,
      // All events are true for the test
      notify_po_created: true,
      notify_po_confirmed: true,
      notify_po_shipped: true,
      notify_po_received: true,
      notify_low_stock: true
    };

    await notifyUsers('TEST', {}, [testSetting]);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Test notification error:', error);
    const message = error instanceof Error ? error.message : 'Failed to send test notification';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
