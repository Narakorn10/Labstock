import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth-utils';
import sql from '@/lib/db';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Display-only: the department column may not exist yet (upgrade_v27), so a failed lookup just means no department.
    let department: string | null = null;
    try {
      const rows = await sql`
        SELECT NULLIF(TRIM(to_jsonb(u) ->> 'department'), '') AS department
        FROM users u
        WHERE u.username = ${user.username}
        LIMIT 1
      `;
      department = (rows[0]?.department as string | null | undefined) ?? null;
    } catch (error) {
      console.error('Auth me department lookup failed:', error);
    }

    return NextResponse.json({
      success: true,
      user: { ...user, department }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
