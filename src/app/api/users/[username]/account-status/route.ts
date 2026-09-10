import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser, isAdmin } from '@/lib/auth-utils';

const ALLOWED_ACCOUNT_STATUSES = new Set(['active', 'suspended']);

async function hasEmailRegistrationSchema() {
  const [userColumns, vendorColumns] = await Promise.all([
    sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'account_status'
    `,
    sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'vendors' AND column_name = 'is_approved'
    `,
  ]);
  return userColumns.length === 1 && vendorColumns.length === 1;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!await hasEmailRegistrationSchema()) {
      return NextResponse.json(
        { error: 'การจัดการสถานะบัญชียังไม่พร้อมใช้งาน กรุณาใช้ migration upgrade_v16_email_auth_registration.sql ก่อน' },
        { status: 503 },
      );
    }

    const { username } = await params;
    const body = await request.json() as { accountStatus?: unknown };
    const accountStatus = typeof body.accountStatus === 'string' ? body.accountStatus : '';
    if (!ALLOWED_ACCOUNT_STATUSES.has(accountStatus)) {
      return NextResponse.json({ error: 'สถานะบัญชีไม่ถูกต้อง' }, { status: 400 });
    }

    const currentUser = await getAuthenticatedUser(request);
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const users = await sql`
      SELECT username, role, vendor, vendor_request, account_status as "accountStatus"
      FROM users
      WHERE LOWER(username) = LOWER(${username.trim()})
      LIMIT 1
    `;
    const targetUser = users[0] as {
      username: string;
      role: string;
      vendor: string | null;
      vendor_request: string | null;
      accountStatus: string;
    } | undefined;
    if (!targetUser) {
      return NextResponse.json({ error: 'ไม่พบบัญชีผู้ใช้' }, { status: 404 });
    }

    if (targetUser.username.toLowerCase() === currentUser.username.toLowerCase()) {
      return NextResponse.json({ error: 'ไม่สามารถเปลี่ยนสถานะบัญชีของตนเองได้' }, { status: 400 });
    }

    if (targetUser.username.toLowerCase() === 'admin') {
      return NextResponse.json({ error: 'ไม่สามารถเปลี่ยนสถานะ Admin หลักได้' }, { status: 400 });
    }

    if (accountStatus === 'suspended' && targetUser.role === 'Admin' && targetUser.accountStatus === 'active') {
      const activeAdmins = await sql`
        SELECT username FROM users
        WHERE role = 'Admin' AND account_status = 'active'
      `;
      if (activeAdmins.length <= 1) {
        return NextResponse.json({ error: 'ไม่สามารถระงับผู้ดูแลระบบคนสุดท้ายได้' }, { status: 400 });
      }
    }

    if (accountStatus === 'active' && targetUser.role === 'Vendor') {
      const vendor = String(targetUser.vendor || '').trim();
      if (!vendor) {
        const message = targetUser.vendor_request
          ? 'บัญชี Vendor นี้รอการตรวจสอบและเพิ่มบริษัทที่ร้องขอก่อน จึงจะอนุมัติได้'
          : 'บัญชี Vendor ต้องมีบริษัทที่ได้รับอนุมัติก่อน จึงจะอนุมัติได้';
        return NextResponse.json({ error: message }, { status: 400 });
      }

      const approvedVendors = await sql`
        SELECT name FROM vendors
        WHERE name = ${vendor} AND is_approved = TRUE
        LIMIT 1
      `;
      if (approvedVendors.length === 0) {
        return NextResponse.json({ error: 'บริษัทของ Vendor ยังไม่ได้รับอนุมัติ จึงไม่สามารถเปิดใช้งานบัญชีได้' }, { status: 400 });
      }
    }

    if (targetUser.accountStatus === accountStatus) {
      return NextResponse.json({ success: true, message: 'สถานะบัญชีเป็นสถานะที่เลือกอยู่แล้ว' });
    }

    const result = await sql`
      UPDATE users
      SET account_status = ${accountStatus}
      WHERE LOWER(username) = LOWER(${username.trim()})
        AND account_status = ${targetUser.accountStatus}
      RETURNING username, account_status as "accountStatus"
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'สถานะบัญชีถูกเปลี่ยนโดยผู้ดูแลคนอื่นแล้ว กรุณารีเฟรชข้อมูล' }, { status: 409 });
    }

    const statusLabel = accountStatus === 'active' ? 'อนุมัติ' : 'ระงับ';
    return NextResponse.json({ success: true, message: `${statusLabel}บัญชีเรียบร้อยแล้ว`, user: result[0] });
  } catch (error: unknown) {
    console.error('User account-status error:', error);
    return NextResponse.json({ error: 'ไม่สามารถเปลี่ยนสถานะบัญชีได้ในขณะนี้' }, { status: 500 });
  }
}
