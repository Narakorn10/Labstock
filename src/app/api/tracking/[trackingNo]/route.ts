import { NextResponse } from 'next/server';
import { trackShipment, getSupportedProviders } from '@/lib/tracking-providers';

export async function GET(request: Request, { params }: { params: Promise<{ trackingNo: string }> }) {
  try {
    const { trackingNo } = await params;
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider') || 'THAIPOST';

    const trackingResult = await trackShipment(provider, trackingNo);

    return NextResponse.json(trackingResult);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error fetching tracking data:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({ providers: getSupportedProviders() });
}
