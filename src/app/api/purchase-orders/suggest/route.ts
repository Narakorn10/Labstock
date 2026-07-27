import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';
import { getPurchaseOrderSuggestions } from '@/lib/purchase-order-suggestions';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedVendor = searchParams.get('vendor');
    const vendor = user.role === 'Vendor' ? user.vendor : requestedVendor;

    if (user.role === 'Vendor' && !vendor) {
      return NextResponse.json({ error: 'Vendor profile is not configured' }, { status: 403 });
    }

    const query = await getPurchaseOrderSuggestions(sql, { vendor });

    return NextResponse.json(query);
  } catch (error: unknown) {
    console.error('Error suggesting PO items:', error);
    return NextResponse.json({ error: 'Failed to suggest items' }, { status: 500 });
  }
}
