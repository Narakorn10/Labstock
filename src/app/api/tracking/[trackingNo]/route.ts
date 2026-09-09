import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getRequestId, withRequestId } from "@/lib/request-observability";
import { getSupportedProviders, trackShipment } from "@/lib/tracking-providers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingNo: string }> },
) {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return withRequestId(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), requestId);
    }

    const { trackingNo } = await params;
    if (!trackingNo.trim() || trackingNo.length > 100) {
      return withRequestId(
        NextResponse.json({ error: "Invalid tracking number" }, { status: 400 }),
        requestId,
      );
    }

    const provider = new URL(request.url).searchParams.get("provider") || "THAIPOST";
    const trackingResult = await trackShipment(provider, trackingNo);
    return withRequestId(NextResponse.json(trackingResult), requestId);
  } catch (error: unknown) {
    console.error(`[Tracking API] requestId=${requestId}`, error);
    return withRequestId(
      NextResponse.json({ error: "Failed to fetch tracking data", requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function OPTIONS() {
  return NextResponse.json({ providers: getSupportedProviders() });
}
