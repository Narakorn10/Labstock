import { NextResponse } from "next/server";
import { apiError, toApiError } from "@/lib/api-response";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getFreshLots } from "@/lib/count-work-orders";
import { getRequestId } from "@/lib/request-observability";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId });
    const lots = await getFreshLots(user, Number((await params).id));
    if (!lots) return apiError("COUNT_ORDER_NOT_FOUND", { requestId });
    const response = NextResponse.json(lots);
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) { return toApiError(error, requestId).response; }
}
