import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getAuthenticatedUser } from '@/lib/auth-utils';
import { ensureVendorNotificationSchema } from '@/lib/vendor-notification-utils';

const sql = neon(process.env.DATABASE_URL || '');

const defaultSettings = {
  email: '',
  line_user_id: '',
  line_display_name: '',
  notify_po_created: true,
  notify_po_confirmed: true,
  notify_po_shipped: true,
  notify_po_received: true,
  notify_low_stock: true,
  notify_expiring_soon: true,
  notify_weekly_summary: true
};

export async function GET(request: Request) {
  try {
    await ensureVendorNotificationSchema();
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }
    if (user.role !== 'Admin' && username !== user.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const settings = await sql`SELECT * FROM notification_settings WHERE username = ${username}`;
    
    if (settings.length === 0) {
      // Return default settings
      return NextResponse.json({
        username,
        ...defaultSettings
      });
    }

    return NextResponse.json({
      username,
      ...defaultSettings,
      ...settings[0],
      notify_expiring_soon: settings[0].notify_expiring_soon ?? true
    });
  } catch (error: unknown) {
    console.error('Error fetching notification settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureVendorNotificationSchema();
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      username, email, line_user_id, line_display_name,
      notify_po_created, notify_po_confirmed, notify_po_shipped, notify_po_received, notify_low_stock, notify_expiring_soon, notify_weekly_summary 
    } = body;

    if (!username) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }
    if (user.role !== 'Admin' && username !== user.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await sql`
      INSERT INTO notification_settings (
        username, email, line_user_id, line_display_name,
        notify_po_created, notify_po_confirmed, notify_po_shipped, notify_po_received, notify_low_stock, notify_expiring_soon, notify_weekly_summary
      ) VALUES (
        ${username}, ${email || null}, ${line_user_id || null}, ${line_display_name || null},
        ${notify_po_created ?? true}, ${notify_po_confirmed ?? true}, ${notify_po_shipped ?? true}, ${notify_po_received ?? true}, ${notify_low_stock ?? true}, ${notify_expiring_soon ?? true}, ${notify_weekly_summary ?? true}
      )
      ON CONFLICT (username) DO UPDATE SET
        email = EXCLUDED.email,
        line_user_id = EXCLUDED.line_user_id,
        line_display_name = EXCLUDED.line_display_name,
        notify_po_created = EXCLUDED.notify_po_created,
        notify_po_confirmed = EXCLUDED.notify_po_confirmed,
        notify_po_shipped = EXCLUDED.notify_po_shipped,
        notify_po_received = EXCLUDED.notify_po_received,
        notify_low_stock = EXCLUDED.notify_low_stock,
        notify_expiring_soon = EXCLUDED.notify_expiring_soon,
        notify_weekly_summary = EXCLUDED.notify_weekly_summary
      RETURNING *
    `;

    return NextResponse.json(result[0]);
  } catch (error: unknown) {
    console.error('Error saving notification settings:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
