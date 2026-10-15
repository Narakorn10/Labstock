import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser, isAdmin } from '@/lib/auth-utils';
import { departmentsReady } from '@/lib/departments-flag';
import { andDept, departmentErrorResponse, getDepartmentScope, type DepartmentScope } from '@/lib/scoped-db';
import { getRequestId } from '@/lib/request-observability';

const LEGACY_V1_WRITE_LOCK_MESSAGE = 'รูปแบบ V1 เป็นแบบอ่านอย่างเดียวแล้ว เพื่อป้องกันผลกระทบต่อ QR/Barcode และ hardcode เดิม กรุณาเพิ่มรูปแบบใหม่ผ่าน Barcode Learning V2';

function legacyV1WriteLockedResponse() {
  return NextResponse.json({ error: LEGACY_V1_WRITE_LOCK_MESSAGE }, { status: 410 });
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    // This read-only V1 list has never required login. Keep that while departments are off (legacy response is
    // unchanged); once departments are ready an anonymous caller would see every department, so require a user.
    const user = await getAuthenticatedUser(request);
    let scope: DepartmentScope;
    if (user) {
      scope = await getDepartmentScope(user);
    } else if (await departmentsReady()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    } else {
      scope = { mode: 'legacy' };
    }
    const patterns = await sql`
      SELECT id, name, regex_pattern, item_id_group, lot_no_group, exp_date_group
      FROM barcode_patterns
      WHERE TRUE${andDept(scope)}
      ORDER BY created_at DESC
    `;
    return NextResponse.json(patterns);
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: Request) {
  void request;
  if (!await isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return legacyV1WriteLockedResponse();
}

export async function DELETE(request: Request) {
  void request;
  if (!await isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return legacyV1WriteLockedResponse();
}
