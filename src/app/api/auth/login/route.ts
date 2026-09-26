import { NextResponse } from 'next/server';
import crypto from 'crypto';
import sql from '@/lib/db';
import { comparePassword, upgradeLegacyPasswordHash } from '@/lib/auth-utils';

type LoginRequest = {
  username?: unknown;
  password?: unknown;
};

type LoginSchemaState = {
  hasEmail: boolean;
  hasAccountStatus: boolean;
};

type LoginUser = {
  username: string;
  password_hash: string;
  name: string;
  role: string;
  vendor?: string | null;
  account_status?: string | null;
};

async function getLoginSchemaState(): Promise<LoginSchemaState> {
  const columns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name IN ('email', 'account_status')
  `;

  const names = new Set(columns.map((column) => String(column.column_name)));
  return {
    hasEmail: names.has('email'),
    hasAccountStatus: names.has('account_status'),
  };
}

async function findUser(identifier: string, schema: LoginSchemaState): Promise<LoginUser | null> {
  const byUsernameAndEmail = schema.hasEmail;
  const selectAccountStatus = schema.hasAccountStatus;

  if (byUsernameAndEmail && selectAccountStatus) {
    const users = await sql`
      SELECT username, password_hash, name, role, vendor, account_status
      FROM users
      WHERE LOWER(username) = LOWER(${identifier})
         OR LOWER(email) = LOWER(${identifier})
      LIMIT 1
    `;
    return (users[0] as LoginUser | undefined) ?? null;
  }

  if (byUsernameAndEmail) {
    const users = await sql`
      SELECT username, password_hash, name, role, vendor
      FROM users
      WHERE LOWER(username) = LOWER(${identifier})
         OR LOWER(email) = LOWER(${identifier})
      LIMIT 1
    `;
    return (users[0] as LoginUser | undefined) ?? null;
  }

  if (selectAccountStatus) {
    const users = await sql`
      SELECT username, password_hash, name, role, vendor, account_status
      FROM users
      WHERE LOWER(username) = LOWER(${identifier})
      LIMIT 1
    `;
    return (users[0] as LoginUser | undefined) ?? null;
  }

  const users = await sql`
    SELECT username, password_hash, name, role, vendor
    FROM users
    WHERE LOWER(username) = LOWER(${identifier})
    LIMIT 1
  `;
  return (users[0] as LoginUser | undefined) ?? null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as LoginRequest;
    const identifier = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!identifier || !password) {
      return NextResponse.json({ error: 'กรุณากรอกอีเมลหรือชื่อผู้ใช้ และรหัสผ่าน' }, { status: 400 });
    }

    const schema = await getLoginSchemaState();
    const user = await findUser(identifier, schema);

    if (!user) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 });
    }

    const isMatch = await comparePassword(password, user.password_hash || '');
    if (!isMatch) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 });
    }

    await upgradeLegacyPasswordHash(user.username, password, user.password_hash);

    const accountStatus = schema.hasAccountStatus ? user.account_status ?? 'active' : 'active';
    if (accountStatus !== 'active') {
      const error = accountStatus === 'pending'
        ? 'บัญชีนี้กำลังรอการอนุมัติจากผู้ดูแลระบบ'
        : 'บัญชีนี้ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ';
      return NextResponse.json({ error }, { status: 403 });
    }

    const token = crypto.randomUUID();
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24);

    await sql`
      UPDATE users
      SET token = ${hashedToken}, token_expiry = ${expiry}
      WHERE username = ${user.username}
    `;

    return NextResponse.json({
      success: true,
      token,
      user: {
        username: user.username,
        name: user.name,
        role: user.role,
        vendor: user.vendor || '',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Login API Error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
