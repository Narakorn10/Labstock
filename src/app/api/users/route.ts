import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { hashPassword, isAdmin } from '@/lib/auth-utils';

export async function GET(request: Request) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await sql`
      SELECT username, name, role, vendor 
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

    const userData = await request.json();
    
    // Check for existing ID
    const existing = await sql`SELECT username FROM users WHERE LOWER(username) = LOWER(${userData.username.trim()})`;
    if (existing.length > 0) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' }, { status: 400 });
    }

    await sql`
      INSERT INTO users (username, password_hash, name, role, vendor)
      VALUES (
        ${userData.username.trim()}, 
        ${await hashPassword(userData.password)}, 
        ${userData.name}, 
        ${userData.role || 'User'}, 
        ${userData.vendor || ''}
      )
    `;

    return NextResponse.json({ success: true, message: 'เพิ่มผู้ใช้สำเร็จ' });
  } catch (error: unknown) {
    console.error('Users error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
