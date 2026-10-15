import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth-utils';
import { loadRuntimeBarcodePatterns } from '@/lib/barcode-runtime';
import { departmentErrorResponse, getDepartmentScope } from '@/lib/scoped-db';
import { getRequestId } from '@/lib/request-observability';

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const scope = await getDepartmentScope(user);
    return NextResponse.json(await loadRuntimeBarcodePatterns(scope));
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    console.error('Barcode runtime catalog error:', error);
    return NextResponse.json({ error: 'Unable to load barcode runtime catalog.' }, { status: 500 });
  }
}
