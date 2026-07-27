import { NextResponse } from "next/server";
import { getAuthenticatedStation } from "@/lib/station-auth";
import { parseStationWithdrawalPayload, syncStationWithdrawal } from "@/lib/station-withdrawals";

export async function POST(request: Request) {
  try {
    const station = await getAuthenticatedStation(request);
    if (!station) return NextResponse.json({ error: "Unauthorized station." }, { status: 401 });

    const payload = parseStationWithdrawalPayload(await request.json());
    if (!payload) {
      return NextResponse.json({ error: "Invalid scanner withdrawal payload." }, { status: 400 });
    }

    const result = await syncStationWithdrawal(station.stationId, payload, {
      userAgent: request.headers.get("user-agent") || "ReagentScannerAgent",
      ipAddress: request.headers.get("x-forwarded-for") || "Unknown",
    });

    return NextResponse.json(result, { status: result.status === "CONFLICT" ? 409 : 200 });
  } catch (error: unknown) {
    console.error("Station withdrawal sync error:", error);
    return NextResponse.json({ error: "Unable to process scanner withdrawal." }, { status: 500 });
  }
}
