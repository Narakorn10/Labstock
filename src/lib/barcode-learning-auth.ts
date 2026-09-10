import { NextResponse } from 'next/server';
import { canManageBarcodeLearningV2 } from '@/lib/auth-utils';
import { isBarcodeLearningV2ManagementEnabled } from '@/lib/barcode-runtime';

export async function requireBarcodeLearningV2Access(request: Request) {
  const access = await canManageBarcodeLearningV2(request);
  if (!access.user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), user: null };
  if (!access.allowed) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), user: null };
  if (!isBarcodeLearningV2ManagementEnabled()) {
    return { response: NextResponse.json({ error: 'Barcode Learning V2 management is disabled.' }, { status: 403 }), user: null };
  }
  return { response: null, user: access.user };
}
