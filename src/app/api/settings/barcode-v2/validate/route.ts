import { NextResponse } from 'next/server';
import { requireBarcodeLearningV2Access } from '@/lib/barcode-learning-auth';
import { hasBarcodeV2AdvancedRegexInput, normalizeV2Payload, validateBarcodeV2Payload } from '@/lib/barcode-learning-v2';

export async function POST(request: Request) {
  const access = await requireBarcodeLearningV2Access(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    if (hasBarcodeV2AdvancedRegexInput(body) && access.user?.role !== 'Admin') {
      return NextResponse.json({ error: 'Advanced Regex and capture groups require an Admin account.' }, { status: 403 });
    }
    const result = await validateBarcodeV2Payload(normalizeV2Payload(body));
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error('Barcode V2 validation error:', error);
    return NextResponse.json({ error: 'Unable to validate barcode pattern.' }, { status: 500 });
  }
}
