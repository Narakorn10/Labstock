import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth-utils';
import { loadRuntimeBarcodePatterns } from '@/lib/barcode-runtime';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await loadRuntimeBarcodePatterns());
  } catch (error: unknown) {
    console.error('Barcode runtime catalog error:', error);
    return NextResponse.json({ error: 'Unable to load barcode runtime catalog.' }, { status: 500 });
  }
}
