import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';
import { getPurchaseOrderSuggestions } from '@/lib/purchase-order-suggestions';
import { isLabPurchasingRole } from '@/lib/purchase-order-workflow';
import { departmentErrorResponse, getDepartmentScope } from '@/lib/scoped-db';
import { getRequestId } from '@/lib/request-observability';

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'Vendor' && !isLabPurchasingRole(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const requestedVendor = searchParams.get('vendor');
    const vendor = user.role === 'Vendor' ? user.vendor : requestedVendor;

    if (user.role === 'Vendor' && !vendor) {
      return NextResponse.json({ error: 'Vendor profile is not configured' }, { status: 403 });
    }

    const scope = await getDepartmentScope(user);
    const query = await getPurchaseOrderSuggestions(sql, { vendor }, scope);

    return NextResponse.json(query);
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    console.error('Error suggesting PO items:', error);
    return NextResponse.json({ error: 'Failed to suggest items' }, { status: 500 });
  }
}
