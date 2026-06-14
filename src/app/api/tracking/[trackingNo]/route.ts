import { NextResponse } from 'next/server';
import { trackShipment, getSupportedProviders } from '@/lib/tracking-providers';

export async function GET(request: Request, { params }: { params: Promise<{ trackingNo: string }> }) {
  try {
    const { trackingNo } = await params;
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider') || 'THAIPOST'; // Default provider

    const trackingResult = await trackShipment(provider, trackingNo);

    return NextResponse.json(trackingResult);
  } catch (error: any) {
    console.error('Error fetching tracking data:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({ providers: getSupportedProviders() });
}
