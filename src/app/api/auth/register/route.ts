import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { hashPassword } from '@/lib/auth-utils';
import { departmentsReady } from '@/lib/departments-flag';
import { findApprovedVendor, listApprovedVendorNames } from '@/lib/vendor-registry';
import { defaultRoomId, listSelectableRooms, parseRoomId } from '@/lib/user-rooms';

type RegistrationRequest = {
  name?: unknown;
  email?: unknown;
  username?: unknown;
  password?: unknown;
  accountType?: unknown;
  vendorMode?: unknown;
  vendorName?: unknown;
  vendorRequest?: unknown;
  departmentId?: unknown;
};

type RegistrationSchemaState = {
  ready: boolean;
};

const REQUIRED_USER_COLUMNS = ['email', 'account_status', 'vendor', 'vendor_request'];
const REQUIRED_VENDOR_COLUMNS = ['is_approved'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

async function getRegistrationSchemaState(): Promise<RegistrationSchemaState> {
  const [userColumns, vendorColumns] = await Promise.all([
    sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
        AND column_name IN ('email', 'account_status', 'vendor', 'vendor_request')
    `,
    sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'vendors'
        AND column_name = 'is_approved'
    `,
  ]);

  const availableUserColumns = new Set(userColumns.map((column) => String(column.column_name)));
  const availableVendorColumns = new Set(vendorColumns.map((column) => String(column.column_name)));

  return {
    ready:
      REQUIRED_USER_COLUMNS.every((column) => availableUserColumns.has(column)) &&
      REQUIRED_VENDOR_COLUMNS.every((column) => availableVendorColumns.has(column)),
  };
}

function migrationRequiredResponse() {
  return NextResponse.json(
    { error: 'การลงทะเบียนด้วยอีเมลยังไม่พร้อมใช้งาน กรุณาใช้ migration upgrade_v16_email_auth_registration.sql ก่อน' },
    { status: 503 },
  );
}

export async function GET() {
  try {
    const schema = await getRegistrationSchemaState();
    if (!schema.ready) {
      return migrationRequiredResponse();
    }

    // Approved companies of every usable room (see vendor-registry).
    const vendors = await listApprovedVendorNames();

    // Rooms to pick from: only when departments are enabled and ready (otherwise empty and the form shows no room field).
    const departments = await departmentsReady() ? await listSelectableRooms() : [];

    return NextResponse.json({
      vendors,
      departments,
      registrationMode: 'pending_approval',
    });
  } catch (error: unknown) {
    console.error('Registration options error:', error);
    return NextResponse.json({ error: 'ไม่สามารถโหลดรายชื่อบริษัทที่ได้รับอนุมัติได้' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const schema = await getRegistrationSchemaState();
    if (!schema.ready) {
      return migrationRequiredResponse();
    }

    const body = await request.json() as RegistrationRequest;
    const name = textValue(body.name);
    const email = textValue(body.email).toLowerCase();
    const username = textValue(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    const accountType = body.accountType === 'lab' || body.accountType === 'vendor'
      ? body.accountType
      : '';

    if (name.length < 2 || name.length > 120) {
      return NextResponse.json({ error: 'กรุณากรอกชื่อ-นามสกุลให้ถูกต้อง' }, { status: 400 });
    }

    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'กรุณากรอกอีเมลให้ถูกต้อง' }, { status: 400 });
    }

    if (username.length < 3 || username.length > 64 || /\s/.test(username)) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้ต้องยาว 3-64 ตัวอักษร และไม่มีช่องว่าง' }, { status: 400 });
    }

    if (password.length < 12 || password.length > 256) {
      return NextResponse.json({ error: 'รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร' }, { status: 400 });
    }

    if (!accountType) {
      return NextResponse.json({ error: 'กรุณาเลือกประเภทบัญชี' }, { status: 400 });
    }

    let role = 'User';
    let vendor = '';
    let vendorRequest: string | null = null;
    let vendorMatch: { name: string; departmentId: number | null } | null = null;

    if (accountType === 'vendor') {
      role = 'Vendor';
      const vendorMode = body.vendorMode === 'existing' || body.vendorMode === 'request'
        ? body.vendorMode
        : '';

      if (vendorMode === 'existing') {
        const vendorName = textValue(body.vendorName);
        if (!vendorName) {
          return NextResponse.json({ error: 'กรุณาเลือกบริษัทที่ได้รับอนุมัติ' }, { status: 400 });
        }

        const match = await findApprovedVendor(vendorName);
        if (!match) {
          return NextResponse.json({ error: 'ไม่พบบริษัทที่ได้รับอนุมัติ โปรดเลือกใหม่หรือส่งคำขอเพิ่มบริษัท' }, { status: 400 });
        }

        vendorMatch = match;
        vendor = match.name;
      } else if (vendorMode === 'request') {
        vendorRequest = textValue(body.vendorRequest);
        if (vendorRequest.length < 2 || vendorRequest.length > 120) {
          return NextResponse.json({ error: 'กรุณาระบุชื่อบริษัทที่ต้องการขอเพิ่มให้ถูกต้อง' }, { status: 400 });
        }
      } else {
        return NextResponse.json({ error: 'กรุณาเลือกบริษัทที่ได้รับอนุมัติ หรือส่งคำขอเพิ่มบริษัท' }, { status: 400 });
      }
    }

    // Departments on: a lab account must pick an active room; an existing-company vendor account goes to the room
    // that owns the company (from the registry lookup); a request-mode vendor (no company yet) goes to the default room (CC).
    // The room is checked in the same statement that creates the user, so a bad room creates nothing.
    const useDepartments = await departmentsReady();
    let roomId: number | null = null;
    if (useDepartments) {
      if (accountType === 'lab') {
        roomId = parseRoomId(body.departmentId);
        if (roomId === null) {
          return NextResponse.json({ error: 'กรุณาเลือกห้องปฏิบัติการ' }, { status: 400 });
        }
      } else if (vendorMatch) {
        // The lookup said "no room" although departments are ready here (the flag changed between the two checks): stop, never guess CC.
        if (vendorMatch.departmentId === null) {
          return NextResponse.json({ error: 'ไม่สามารถลงทะเบียนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง' }, { status: 503 });
        }
        roomId = vendorMatch.departmentId;
      } else {
        roomId = await defaultRoomId();
        if (roomId === null) {
          return NextResponse.json({ error: 'ยังไม่สามารถลงทะเบียนบัญชีบริษัทได้ในขณะนี้ กรุณาติดต่อผู้ดูแลระบบ' }, { status: 503 });
        }
      }
    }

    const existingUsers = await sql`
      SELECT username
      FROM users
      WHERE LOWER(username) = LOWER(${username})
         OR LOWER(email) = LOWER(${email})
      LIMIT 1
    `;

    if (existingUsers.length > 0) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้หรืออีเมลนี้มีอยู่ในระบบแล้ว' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    if (useDepartments) {
      const created = await sql`
        WITH room AS (
          SELECT id FROM departments WHERE id = ${roomId} AND is_active AND code IS NOT NULL
        ), new_user AS (
          INSERT INTO users (username, password_hash, name, role, vendor, email, account_status, vendor_request)
          SELECT ${username}, ${passwordHash}, ${name}, ${role}, ${vendor}, ${email}, 'pending', ${vendorRequest}
          FROM room
          RETURNING username
        )
        INSERT INTO user_departments (username, department_id, role, is_default)
        SELECT new_user.username, room.id, NULL, true FROM new_user, room
        RETURNING username
      `;
      if (created.length === 0) {
        return NextResponse.json({ error: 'ห้องปฏิบัติการที่เลือกไม่ถูกต้องหรือปิดใช้งานอยู่ กรุณาเลือกใหม่' }, { status: 400 });
      }
    } else {
      await sql`
        INSERT INTO users (
          username,
          password_hash,
          name,
          role,
          vendor,
          email,
          account_status,
          vendor_request
        )
        VALUES (
          ${username},
          ${passwordHash},
          ${name},
          ${role},
          ${vendor},
          ${email},
          'pending',
          ${vendorRequest}
        )
      `;
    }

    return NextResponse.json({
      success: true,
      status: 'pending',
      message: 'ลงทะเบียนสำเร็จ บัญชีของคุณอยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบ',
    }, { status: 201 });
  } catch (error: unknown) {
    const databaseError = error as { code?: string };
    if (databaseError.code === '23505') {
      return NextResponse.json({ error: 'ชื่อผู้ใช้หรืออีเมลนี้มีอยู่ในระบบแล้ว' }, { status: 409 });
    }

    console.error('Registration error:', error);
    return NextResponse.json({ error: 'ไม่สามารถลงทะเบียนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
