import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser, hasUserAccountStatusColumn, hasUserDepartmentColumn, hasUserPinColumn, hashPassword, hashPin, isAdmin } from '@/lib/auth-utils';

const ALLOWED_ROLES = new Set(['User', 'Operator', 'Manager', 'Admin', 'Vendor']);

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
    const updateData = await request.json() as Record<string, unknown>;
    const pinEnabled = await hasUserPinColumn();
    const password = normalizeOptionalText(updateData.password);
    const pin = normalizeOptionalText(updateData.pin);
    const name = normalizeOptionalText(updateData.name);
    const role = normalizeOptionalText(updateData.role);
    const department = normalizeOptionalText(updateData.department);

    if (department.length > 160) {
      return NextResponse.json({ error: 'ชื่อหน่วยงานต้องไม่เกิน 160 ตัวอักษร' }, { status: 400 });
    }
    if (!name || name.length > 160) {
      return NextResponse.json({ error: 'กรุณาระบุชื่อผู้ใช้ให้ถูกต้อง' }, { status: 400 });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Role ไม่ถูกต้อง' }, { status: 400 });
    }
    if (password && password.length < 8) {
      return NextResponse.json({ error: 'Password ต้องมีอย่างน้อย 8 ตัวอักษร' }, { status: 400 });
    }

    if (pin && !pinEnabled) {
      return NextResponse.json({ error: 'PIN support is not enabled yet. Run upgrade_v5_user_pin.sql first.' }, { status: 400 });
    }

    if (pin && !validatePin(pin)) {
      return NextResponse.json({ error: 'PIN must be 4-6 digits.' }, { status: 400 });
    }

    const newPasswordHash = password ? await hashPassword(password) : null;
    const newPinHash = pin ? await hashPin(pin) : null;

    const accountStatusEnabled = await hasUserAccountStatusColumn();
    const users = accountStatusEnabled ? await sql`
      SELECT username, role, account_status FROM users
      WHERE LOWER(username) = LOWER(${username.trim()})
      LIMIT 1
    ` : await sql`
      SELECT username, role, NULL::text AS account_status FROM users
      WHERE LOWER(username) = LOWER(${username.trim()})
      LIMIT 1
    `;

    if (users.length === 0) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้ที่ต้องการแก้ไข' }, { status: 404 });
    }

    const currentUser = await getAuthenticatedUser(request);
    if (currentUser?.username.toLowerCase() === username.trim().toLowerCase() && currentUser.role === 'Admin' && role !== 'Admin') {
      return NextResponse.json({ error: 'ไม่สามารถลดสิทธิ์ Admin ของบัญชีที่กำลังใช้งานอยู่ได้' }, { status: 400 });
    }
    if (users[0].username.toLowerCase() === 'admin' && role !== 'Admin') {
      return NextResponse.json({ error: 'ไม่สามารถลดสิทธิ์ Admin หลักได้' }, { status: 400 });
    }
    if (users[0].role === 'Admin' && role !== 'Admin') {
      const activeAdmins = accountStatusEnabled
        ? await sql`SELECT username FROM users WHERE role = 'Admin' AND account_status = 'active'`
        : await sql`SELECT username FROM users WHERE role = 'Admin'`;
      if (activeAdmins.length <= 1) {
        return NextResponse.json({ error: 'ไม่สามารถลดสิทธิ์ Admin คนสุดท้ายได้' }, { status: 400 });
      }
    }

    if (newPasswordHash) {
      await sql`
        UPDATE users 
        SET 
          name = ${name}, 
          role = ${role}, 
          vendor = ${normalizeOptionalText(updateData.vendor)},
          password_hash = ${newPasswordHash},
          pin_hash = COALESCE(${newPinHash}, pin_hash)
        WHERE LOWER(username) = LOWER(${username.trim()})
      `;
    } else {
      await sql`
        UPDATE users 
        SET 
          name = ${name}, 
          role = ${role}, 
          vendor = ${normalizeOptionalText(updateData.vendor)},
          pin_hash = COALESCE(${newPinHash}, pin_hash)
        WHERE LOWER(username) = LOWER(${username.trim()})
      `;
    }
    if ('department' in updateData && await hasUserDepartmentColumn()) {
      await sql`
        UPDATE users SET department = ${department || null}
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
