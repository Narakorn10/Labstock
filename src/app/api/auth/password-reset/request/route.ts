import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { sendEmail } from '@/lib/notifications';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_RESPONSE = { success: true, message: 'หากอีเมลนี้อยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่แล้ว' };

async function resetSchemaReady() {
  const result = await sql`
    SELECT
      to_regclass('public.password_reset_tokens') IS NOT NULL AS has_reset_tokens,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email'
      ) AS has_email
  `;
  return Boolean(result[0]?.has_reset_tokens && result[0]?.has_email);
}

function applicationUrl(request: NextRequest) {
  const configuredUrl = process.env.APP_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (configuredUrl) return new URL(configuredUrl).origin;
  if (process.env.NODE_ENV !== 'production') return request.nextUrl.origin;
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(email) || email.length > 254 || !await resetSchemaReady()) {
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const users = await sql`
      SELECT username, email
      FROM users
      WHERE LOWER(email) = ${email} AND account_status = 'active'
      LIMIT 1
    `;
    const user = users[0] as { username: string; email: string } | undefined;
    if (!user) return NextResponse.json(GENERIC_RESPONSE);

    const requests = await sql`
      SELECT COUNT(*)::int AS count
      FROM password_reset_tokens
      WHERE username = ${user.username} AND created_at > NOW() - INTERVAL '15 minutes'
    `;
    if (Number(requests[0]?.count ?? 0) >= 3) return NextResponse.json(GENERIC_RESPONSE);

    const baseUrl = applicationUrl(request);
    if (!baseUrl || !process.env.SMTP_USER) {
      console.error('Password reset delivery is not configured');
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await sql`UPDATE password_reset_tokens SET used_at = NOW() WHERE username = ${user.username} AND used_at IS NULL`;
    await sql`
      INSERT INTO password_reset_tokens (username, token_hash, expires_at)
      VALUES (${user.username}, ${tokenHash}, NOW() + INTERVAL '15 minutes')
    `;

    const resetUrl = new URL('/reset-password', baseUrl);
    resetUrl.searchParams.set('token', token);
    const delivered = await sendEmail(
      user.email,
      'ตั้งรหัสผ่าน LabStock ใหม่',
      `<p>มีคำขอตั้งรหัสผ่าน LabStock ใหม่</p><p><a href="${resetUrl.toString()}">ตั้งรหัสผ่านใหม่</a></p><p>ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุภายใน 15 นาที หากคุณไม่ได้เป็นผู้ขอ ให้ละเว้นอีเมลนี้</p>`,
    );

    if (!delivered) {
      await sql`DELETE FROM password_reset_tokens WHERE token_hash = ${tokenHash} AND used_at IS NULL`;
    }
    return NextResponse.json(GENERIC_RESPONSE);
  } catch (error) {
    console.error('Password reset request error:', error);
    return NextResponse.json(GENERIC_RESPONSE);
  }
}
