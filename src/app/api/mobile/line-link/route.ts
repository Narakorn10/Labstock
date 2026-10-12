import { NextResponse } from "next/server";
import { verifyUserPin } from "@/lib/auth-utils";
import { getLineLinkedUser, hasUserLineIdColumn, verifyLineIdToken } from "@/lib/line-liff-auth";
import { linkLineRichMenuForRole } from "@/lib/line-bot";
import { PIN_ATTEMPT_LIMIT, countRecentPinAttempts, markPinAttemptSuccess, recordPinAttempt } from "@/lib/pin-attempts";
import sql from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { idToken?: unknown; username?: unknown; pin?: unknown };
    const identity = await verifyLineIdToken(typeof body.idToken === "string" ? body.idToken : "");
    if (!identity) return NextResponse.json({ error: "LINE authentication failed." }, { status: 401 });
    if (!await hasUserLineIdColumn()) {
      return NextResponse.json({ error: "LINE LIFF approval is not enabled yet. Run upgrade_v9_line_liff_auth.sql first." }, { status: 400 });
    }

    const linkedUser = await getLineLinkedUser(identity.sub);
    if (linkedUser) {
      return NextResponse.json({ error: "This LINE account is already linked to another user." }, { status: 409 });
    }

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    if (!username || !pin) {
      return NextResponse.json({ error: "Username and PIN are required." }, { status: 400 });
    }

    // Same shared counter as /api/mobile/confirm. Unlike confirm, this fails closed: linking grants
    // long-lived access, so no PIN check happens when the limiter cannot record/count attempts.
    const pinAttemptId = await recordPinAttempt(username, "line-link");
    const recentAttempts = await countRecentPinAttempts(username);
    if (pinAttemptId === null || recentAttempts === null) {
      return NextResponse.json({ error: "ระบบตรวจ PIN ไม่พร้อม กรุณาลองใหม่ภายหลัง" }, { status: 503 });
    }
    if (recentAttempts > PIN_ATTEMPT_LIMIT) {
      return NextResponse.json({ error: "ใส่ PIN ผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่", code: "RATE_LIMITED" }, { status: 429 });
    }

    const user = await verifyUserPin(username, pin);
    if (!user) return NextResponse.json({ error: "Invalid username or PIN." }, { status: 401 });
    await markPinAttemptSuccess(pinAttemptId);
    if (user.role === "Vendor") {
      return NextResponse.json({ error: "This role cannot approve mobile stock transactions." }, { status: 403 });
    }

    await sql`
      UPDATE users
      SET line_user_id = ${identity.sub}
      WHERE username = ${user.username}
    `;
    await linkLineRichMenuForRole(identity.sub, user.role);

    return NextResponse.json({ linked: true, user });
  } catch (error) {
    console.error("LINE LIFF link error:", error);
    return NextResponse.json({ error: "Unable to link LINE account." }, { status: 400 });
  }
}
