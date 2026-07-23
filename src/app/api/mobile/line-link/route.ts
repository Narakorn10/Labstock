import { NextResponse } from "next/server";
import { verifyUserPin } from "@/lib/auth-utils";
import { getLineLinkedUser, hasUserLineIdColumn, verifyLineIdToken } from "@/lib/line-liff-auth";
import { linkLineRichMenuForRole } from "@/lib/line-bot";
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
    const user = await verifyUserPin(username, pin);
    if (!user) return NextResponse.json({ error: "Invalid username or PIN." }, { status: 401 });
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
