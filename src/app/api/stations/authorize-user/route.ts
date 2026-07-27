import crypto from "crypto";
import { NextResponse } from "next/server";
import { hasUserPinColumn, verifyUserPin } from "@/lib/auth-utils";
import sql from "@/lib/db";
import { getAuthenticatedStation } from "@/lib/station-auth";

const AUTHORIZATION_LIFETIME_HOURS = 12;

export async function POST(request: Request) {
  try {
    const station = await getAuthenticatedStation(request);
    if (!station) return NextResponse.json({ error: "Unauthorized station." }, { status: 401 });

    const body = await request.json() as { username?: unknown; pin?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    if (!username || !pin || pin.length > 64) {
      return NextResponse.json({ error: "Username and PIN are required." }, { status: 400 });
    }

    if (!await hasUserPinColumn()) {
      return NextResponse.json({ error: "PIN support is not enabled yet." }, { status: 400 });
    }

    const user = await verifyUserPin(username, pin);
    if (!user) return NextResponse.json({ error: "Invalid username or PIN." }, { status: 401 });
    if (user.role === "Vendor") {
      return NextResponse.json({ error: "This role cannot approve scanner withdrawals." }, { status: 403 });
    }

    const authorizationToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(authorizationToken).digest("hex");
    const expiresAt = new Date(Date.now() + AUTHORIZATION_LIFETIME_HOURS * 60 * 60 * 1000);
    await sql`
      INSERT INTO station_user_authorizations (station_id, username, token_hash, expires_at)
      VALUES (${station.stationId}, ${user.username}, ${tokenHash}, ${expiresAt.toISOString()}::timestamptz)
    `;

    return NextResponse.json({
      username: user.username,
      authorization_token: authorizationToken,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error: unknown) {
    console.error("Station user authorization error:", error);
    return NextResponse.json({ error: "Unable to authorize scanner user." }, { status: 500 });
  }
}
