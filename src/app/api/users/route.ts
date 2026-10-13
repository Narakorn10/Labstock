import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { hasUserDepartmentColumn, hasUserPinColumn, hashPassword, hashPin, isAdmin } from '@/lib/auth-utils';
import { departmentsReady } from '@/lib/departments-flag';
import { defaultRoomId, parseRoomId } from '@/lib/user-rooms';

const ALLOWED_ROLES = new Set(['User', 'Operator', 'Manager', 'Admin', 'Vendor']);

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
          SELECT username, name, role, vendor, to_jsonb(users) ->> 'department' AS department, email, account_status as "accountStatus", vendor_request as "vendorRequest",
                 (pin_hash IS NOT NULL AND pin_hash != '') as "hasPin"
          FROM users
          ORDER BY CASE account_status WHEN 'pending' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END, username ASC
        `
      : emailRegistrationEnabled
        ? await sql`
            SELECT username, name, role, vendor, to_jsonb(users) ->> 'department' AS department, email, account_status as "accountStatus", vendor_request as "vendorRequest",
                   false as "hasPin"
            FROM users
            ORDER BY CASE account_status WHEN 'pending' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END, username ASC
          `
      : pinEnabled
      ? await sql`
          SELECT username, name, role, vendor, to_jsonb(users) ->> 'department' AS department, (pin_hash IS NOT NULL AND pin_hash != '') as "hasPin"
          FROM users
          ORDER BY username ASC
        `
      : await sql`
          SELECT username, name, role, vendor, to_jsonb(users) ->> 'department' AS department, false as "hasPin"
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

    const userData = await request.json() as Record<string, unknown>;
    const username = typeof userData.username === 'string' ? userData.username.trim() : '';
    const name = typeof userData.name === 'string' ? userData.name.trim() : '';
    const password = typeof userData.password === 'string' ? userData.password : '';
    const role = typeof userData.role === 'string' ? userData.role : 'User';
    const pin = typeof userData.pin === 'string' ? userData.pin.trim() : '';
    const department = typeof userData.department === 'string' ? userData.department.trim() : '';
    if (department.length > 160) {
      return NextResponse.json({ error: 'ชื่อหน่วยงานต้องไม่เกิน 160 ตัวอักษร' }, { status: 400 });
    }
    if (!/^[A-Za-z0-9._-]{2,80}$/.test(username)) {
      return NextResponse.json({ error: 'Username ต้องเป็นภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง ความยาว 2-80 ตัวอักษร' }, { status: 400 });
    }
    if (!name || name.length > 160) {
      return NextResponse.json({ error: 'กรุณาระบุชื่อผู้ใช้ให้ถูกต้อง' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password ต้องมีอย่างน้อย 8 ตัวอักษร' }, { status: 400 });
    }
    if (pin && !/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ error: 'PIN ต้องเป็นตัวเลข 4-6 หลัก' }, { status: 400 });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Role ไม่ถูกต้อง' }, { status: 400 });
    }
    const pinEnabled = await hasUserPinColumn();

    if (pin && !pinEnabled) {
      return NextResponse.json({ error: 'PIN support is not enabled yet. Run upgrade_v5_user_pin.sql first.' }, { status: 400 });
    }
    
    // Check for existing ID
    const existing = await sql`SELECT username FROM users WHERE LOWER(username) = LOWER(${username})`;
    if (existing.length > 0) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const pinHash = pinEnabled && pin ? await hashPin(pin) : null;
    const vendorName = typeof userData.vendor === 'string' ? userData.vendor.trim() : '';

    if (await departmentsReady()) {
      // Departments on: the new user must belong to a room, otherwise department-aware login rejects them.
      // Room = departmentId from the request, else the default room (CC). Checked in the same statement as the insert.
      const requested = userData.departmentId === undefined || userData.departmentId === null || userData.departmentId === ''
        ? await defaultRoomId()
        : parseRoomId(userData.departmentId);
      if (requested === null) {
        return NextResponse.json({ error: 'ห้องปฏิบัติการไม่ถูกต้อง' }, { status: 400 });
      }
      const created = await sql`
        WITH room AS (
          SELECT id FROM departments WHERE id = ${requested} AND is_active AND code IS NOT NULL
        ), new_user AS (
          INSERT INTO users (username, password_hash, pin_hash, name, role, vendor)
          SELECT ${username}, ${passwordHash}, ${pinHash}, ${name}, ${role}, ${vendorName} FROM room
          RETURNING username
        )
        INSERT INTO user_departments (username, department_id, role, is_default)
        SELECT new_user.username, room.id, NULL, true FROM new_user, room
        RETURNING username
      `;
      if (created.length === 0) {
        return NextResponse.json({ error: 'ห้องปฏิบัติการที่เลือกไม่ถูกต้องหรือปิดใช้งานอยู่' }, { status: 400 });
      }
    } else {
      await sql`
        INSERT INTO users (username, password_hash, pin_hash, name, role, vendor)
        VALUES (${username}, ${passwordHash}, ${pinHash}, ${name}, ${role}, ${vendorName})
      `;
    }
    if (department && await hasUserDepartmentColumn()) {
      await sql`UPDATE users SET department = ${department} WHERE username = ${username}`;
    }

    return NextResponse.json({ success: true, message: 'เพิ่มผู้ใช้สำเร็จ' });
  } catch (error: unknown) {
    console.error('Users error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
