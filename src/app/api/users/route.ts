import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { hashPassword, isAdmin } from '@/lib/auth-utils';

export async function GET(request: Request) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await sql`
      SELECT username, name, role, company 
      FROM users 
      ORDER BY username ASC
    `;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Users GET Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userData = await request.json();
    
    // Check for existing ID
    const existing = await sql`SELECT username FROM users WHERE LOWER(username) = LOWER(${userData.username.trim()})`;
    if (existing.length > 0) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' }, { status: 400 });
    }

    await sql`
      INSERT INTO users (username, password_hash, name, role, company)
      VALUES (
        ${userData.username.trim()}, 
        ${await hashPassword(userData.password)}, 
        ${userData.name}, 
        ${userData.role || 'User'}, 
        ${userData.company || ''}
      )
    `;

    return NextResponse.json({ success: true, message: 'เพิ่มผู้ใช้สำเร็จ' });
  } catch (error: any) {
    console.error('Users POST Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
