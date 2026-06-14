import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { hashPassword, isAdmin } from '@/lib/auth-utils';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { username } = await params;
    const updateData = await request.json();

    const users = await sql`
      SELECT username FROM users 
      WHERE LOWER(username) = LOWER(${username.trim()})
      LIMIT 1
    `;

    if (users.length === 0) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้ที่ต้องการแก้ไข' }, { status: 404 });
    }

    if (updateData.password) {
      const newHash = await hashPassword(updateData.password);
      await sql`
        UPDATE users 
        SET 
          name = ${updateData.name}, 
          role = ${updateData.role}, 
          vendor = ${updateData.vendor || ''},
          password_hash = ${newHash}
        WHERE LOWER(username) = LOWER(${username.trim()})
      `;
    } else {
      await sql`
        UPDATE users 
        SET 
          name = ${updateData.name}, 
          role = ${updateData.role}, 
          vendor = ${updateData.vendor || ''}
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
