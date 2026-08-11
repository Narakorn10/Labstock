import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { hasUserPinColumn, hashPassword, hashPin, isAdmin } from '@/lib/auth-utils';

async function hasEmailRegistrationColumns() {
  const columns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name IN ('email', 'account_status', 'vendor_request')
  `;
  const names = new Set(columns.map((column) => String(column.column_name)));
  return ['email', 'account_status', 'vendor_request'].every((column) => names.has(column));
}

export async function GET(request: Request) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [pinEnabled, emailRegistrationEnabled] = await Promise.all([
      hasUserPinColumn(),
      hasEmailRegistrationColumns(),
    ]);
    const data = emailRegistrationEnabled && pinEnabled
      ? await sql`
          SELECT username, name, role, vendor, email, account_status as "accountStatus", vendor_request as "vendorRequest",
                 (pin_hash IS NOT NULL AND pin_hash != '') as "hasPin"
          FROM users
          ORDER BY CASE account_status WHEN 'pending' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END, username ASC
        `
      : emailRegistrationEnabled
        ? await sql`
            SELECT username, name, role, vendor, email, account_status as "accountStatus", vendor_request as "vendorRequest",
                   false as "hasPin"
            FROM users
            ORDER BY CASE account_status WHEN 'pending' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END, username ASC
          `
      : pinEnabled
      ? await sql`
          SELECT username, name, role, vendor, (pin_hash IS NOT NULL AND pin_hash != '') as "hasPin"
          FROM users
          ORDER BY username ASC
        `
      : await sql`
          SELECT username, name, role, vendor, false as "hasPin"
          FROM users
          ORDER BY username ASC
        `;

    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('Users error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userData = await request.json();
    const pinEnabled = await hasUserPinColumn();

    if (userData.pin && !pinEnabled) {
      return NextResponse.json({ error: 'PIN support is not enabled yet. Run upgrade_v5_user_pin.sql first.' }, { status: 400 });
    }
    
    // Check for existing ID
    const existing = await sql`SELECT username FROM users WHERE LOWER(username) = LOWER(${userData.username.trim()})`;
    if (existing.length > 0) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' }, { status: 400 });
    }

    await sql`
      INSERT INTO users (username, password_hash, pin_hash, name, role, vendor)
      VALUES (
        ${userData.username.trim()}, 
        ${await hashPassword(userData.password)}, 
        ${pinEnabled && userData.pin ? await hashPin(userData.pin) : null},
        ${userData.name}, 
        ${userData.role || 'User'}, 
        ${userData.vendor || ''}
      )
    `;

    return NextResponse.json({ success: true, message: 'เพิ่มผู้ใช้สำเร็จ' });
  } catch (error: unknown) {
    console.error('Users error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
