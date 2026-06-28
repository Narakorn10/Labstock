import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { hasUserPinColumn, hashPassword, hashPin, isAdmin } from '@/lib/auth-utils';

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function validatePin(pin: string) {
  return /^\d{4,6}$/.test(pin);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { username } = await params;
    const updateData = await request.json();
    const pinEnabled = await hasUserPinColumn();
    const password = normalizeOptionalText(updateData.password);
    const pin = normalizeOptionalText(updateData.pin);

    if (pin && !pinEnabled) {
      return NextResponse.json({ error: 'PIN support is not enabled yet. Run upgrade_v5_user_pin.sql first.' }, { status: 400 });
    }

    if (pin && !validatePin(pin)) {
      return NextResponse.json({ error: 'PIN must be 4-6 digits.' }, { status: 400 });
    }

    const newPasswordHash = password ? await hashPassword(password) : null;
    const newPinHash = pin ? await hashPin(pin) : null;

    const users = await sql`
      SELECT username FROM users 
      WHERE LOWER(username) = LOWER(${username.trim()})
      LIMIT 1
    `;

    if (users.length === 0) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้ที่ต้องการแก้ไข' }, { status: 404 });
    }

    if (newPasswordHash) {
      await sql`
        UPDATE users 
        SET 
          name = ${updateData.name}, 
          role = ${updateData.role}, 
          vendor = ${updateData.vendor || ''},
          password_hash = ${newPasswordHash},
          pin_hash = COALESCE(${newPinHash}, pin_hash)
        WHERE LOWER(username) = LOWER(${username.trim()})
      `;
    } else {
      await sql`
        UPDATE users 
        SET 
          name = ${updateData.name}, 
          role = ${updateData.role}, 
          vendor = ${updateData.vendor || ''},
          pin_hash = COALESCE(${newPinHash}, pin_hash)
        WHERE LOWER(username) = LOWER(${username.trim()})
      `;
    }

    return NextResponse.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ' });
  } catch (error: unknown) {
    console.error('User error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { username } = await params;

    if (username.toLowerCase() === 'admin') {
      return NextResponse.json({ error: 'ไม่สามารถลบ Admin หลักได้' }, { status: 400 });
    }

    const result = await sql`
      DELETE FROM users 
      WHERE LOWER(username) = LOWER(${username.trim()})
      RETURNING username
    `;

    if (result.length > 0) {
      return NextResponse.json({ success: true, message: 'ลบผู้ใช้สำเร็จ' });
    } else {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้ที่ต้องการลบ' }, { status: 404 });
    }

  } catch (error: unknown) {
    console.error('User error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
