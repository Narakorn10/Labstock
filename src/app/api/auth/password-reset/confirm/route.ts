import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { hashPassword } from '@/lib/auth-utils';
import sql from '@/lib/db';

function validPassword(password: string) {
  return password.length >= 12 && password.length <= 256;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: unknown; password?: unknown };
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!token || !validPassword(password)) {
      return NextResponse.json({ error: 'กรุณาตั้งรหัสผ่านอย่างน้อย 12 ตัวอักษร' }, { status: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const passwordHash = await hashPassword(password);
    const users = await sql`
      WITH consumed AS (
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > NOW()
        RETURNING username
      )
      UPDATE users
      SET password_hash = ${passwordHash}, token = NULL, token_expiry = NULL, session_version = session_version + 1
      FROM consumed
      WHERE users.username = consumed.username
      RETURNING users.username
    `;
    const user = users[0] as { username: string } | undefined;
    if (!user) {
      return NextResponse.json({ error: 'ลิงก์ตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว' }, { status: 400 });
    }

    await sql`UPDATE password_reset_tokens SET used_at = NOW() WHERE username = ${user.username} AND used_at IS NULL`;
    return NextResponse.json({ success: true, message: 'ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบอีกครั้ง' });
  } catch (error) {
    console.error('Password reset confirmation error:', error);
    return NextResponse.json({ error: 'ไม่สามารถตั้งรหัสผ่านใหม่ได้ในขณะนี้' }, { status: 500 });
  }
}
