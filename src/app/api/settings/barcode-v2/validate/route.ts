import { NextResponse } from 'next/server';
import { requireBarcodeLearningV2Access } from '@/lib/barcode-learning-auth';
import { hasBarcodeV2AdvancedRegexInput, normalizeV2Payload, validateBarcodeV2Payload } from '@/lib/barcode-learning-v2';
import { departmentErrorResponse, getDepartmentScope } from '@/lib/scoped-db';
import { getRequestId } from '@/lib/request-observability';

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const access = await requireBarcodeLearningV2Access(request);
  if (access.response || !access.user) return access.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // Read-only check: "all" (global Admin) validates against every department, a room user against their own.
    const scope = await getDepartmentScope(access.user);
    const body = await request.json();
    if (hasBarcodeV2AdvancedRegexInput(body) && access.user?.role !== 'Admin') {
      return NextResponse.json({ error: 'Advanced Regex and capture groups require an Admin account.' }, { status: 403 });
    }
    const result = await validateBarcodeV2Payload(normalizeV2Payload(body), { scope });
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    console.error('Barcode V2 validation error:', error);
    return NextResponse.json({ error: 'Unable to validate barcode pattern.' }, { status: 500 });
  }
}
