import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { comparePassword } from '@/lib/auth-utils';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    const users = await sql`
      SELECT username, password_hash, name, role, company 
      FROM users 
      WHERE LOWER(username) = LOWER(${username.trim()})
      LIMIT 1
    `;

    if (users.length === 0) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 });
    }

    const user = users[0];
    const isMatch = await comparePassword(password, user.password_hash || '');
    
    if (!isMatch) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 });
    }

    const token = crypto.randomUUID();
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24);

    // Save hashed token and expiry back to DB
    await sql`
      UPDATE users 
      SET token = ${hashedToken}, token_expiry = ${expiry} 
      WHERE username = ${user.username}
    `;

    return NextResponse.json({
      success: true,
      token, // Return plain token to client
      user: {
        username: user.username,
        name: user.name,
        role: user.role,
        company: user.company || ''
      }
    });

  } catch (error: any) {
    console.error('Login API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
