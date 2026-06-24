import { NextResponse } from 'next/server';
import { notifyUsers } from '@/lib/notifications';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { type, value, username } = await request.json();

    if (!type || !value || !username) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }
    if (user.role !== 'Admin' && username !== user.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  } catch (error: any) {
    console.error('Test notification error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
