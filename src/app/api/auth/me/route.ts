import { NextResponse } from 'next/server';
import { getAuthenticatedUser, type AuthenticatedUser } from '@/lib/auth-utils';
import sql from '@/lib/db';
import { listUserDepartments } from '@/lib/department-switch';
import type { DepartmentContext } from '@/lib/department-switcher-types';
import { isMissingDepartmentSchemaError, markDepartmentsNotReady } from '@/lib/departments-flag';

/** Context used when the department list cannot be built: no options, active taken from the user as resolved. Pure. */
function fallbackDepartmentContext(user: AuthenticatedUser): DepartmentContext {
  const scope = user.scope as number | 'ALL';
  const all = scope === 'ALL';
  const departmentId = typeof user.departmentId === 'number' ? user.departmentId : null;
  return {
    scope,
    active: all || departmentId === null
      ? null
      : { id: departmentId, name: user.departmentCode ?? 'งานปัจจุบัน', code: user.departmentCode ?? null },
    options: null,
    canViewAll: user.globalRole === 'Admin',
    readOnly: all
  };
}

async function buildDepartmentContext(user: AuthenticatedUser): Promise<DepartmentContext> {
  // A Vendor is locked to its own department and gets no options; the list is [] so skip the query.
  if (user.globalRole === 'Vendor') {
    const fallback = fallbackDepartmentContext(user);
    return { ...fallback, options: [] };
  }

  const rows = await listUserDepartments(user.username);
  const options = rows
    .filter((row) => row.switchable && row.code !== null)
    .map((row) => ({ id: row.id, name: row.name, code: row.code as string }));
  const canViewAll = user.globalRole === 'Admin';

  // In the "ALL" view departmentId is always null, so there is no active department to look up.
  if (user.scope === 'ALL') {
    return { scope: 'ALL', active: null, options, canViewAll, readOnly: true };
  }

  const current = rows.find((row) => row.id === user.departmentId);
  if (!current) return fallbackDepartmentContext(user);
  return {
    scope: user.scope as number,
    active: { id: current.id, name: current.name, code: current.code },
    options,
    canViewAll,
    readOnly: false
  };
}

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

    // Switcher data. user.scope is only set by the department-aware auth path (flag on and schema ready), so with the
    // flag off nothing below runs and the body is unchanged. auth-provider signs the user out when /me is not ok,
    // so nothing in this block may ever turn into a 500: two nested try/catch, and the key is simply left out on failure.
    let departmentContext: DepartmentContext | undefined;
    if (typeof user.scope === 'number' || user.scope === 'ALL') {
      try {
        departmentContext = await buildDepartmentContext(user);
      } catch (error) {
        try {
          if (isMissingDepartmentSchemaError(error)) {
            markDepartmentsNotReady(`auth me department list failed (${(error as { code?: string }).code}); using legacy path`);
          } else {
            console.error('Auth me department context failed:', error);
          }
          departmentContext = fallbackDepartmentContext(user);
        } catch (fallbackError) {
          console.error('Auth me department fallback failed:', fallbackError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      user: { ...user, department },
      ...(departmentContext ? { departmentContext } : {})
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
