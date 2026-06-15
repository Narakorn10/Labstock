import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser, isAdmin } from '@/lib/auth-utils';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role === 'Admin') {
      // Return all roles for management
      const data = await sql`SELECT role, allowed_menus FROM role_permissions ORDER BY role ASC`;
      return NextResponse.json(data);
    } else {
      // Return only the current user's role permissions
      const data = await sql`
        SELECT role, allowed_menus 
        FROM role_permissions 
        WHERE role = ${user.role}
      `;
      return NextResponse.json(data[0] || { role: user.role, allowed_menus: [] });
    }
  } catch (error: unknown) {
    console.error('Permissions GET error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { role, allowed_menus } = await request.json();
    
    if (!role) {
      return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    }

    await sql`
      INSERT INTO role_permissions (role, allowed_menus)
      VALUES (${role}, ${allowed_menus})
      ON CONFLICT (role) DO UPDATE SET 
        allowed_menus = EXCLUDED.allowed_menus,
        updated_at = NOW()
    `;

    return NextResponse.json({ success: true, message: 'บันทึกสิทธิ์เรียบร้อยแล้ว' });
  } catch (error: unknown) {
    console.error('Permissions POST error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
