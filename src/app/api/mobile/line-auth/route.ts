import { NextResponse } from "next/server";
import { getLineLinkedUser, hasUserLineIdColumn, verifyLineIdToken } from "@/lib/line-liff-auth";

export async function POST(request: Request) {
  try {
    const { idToken } = await request.json() as { idToken?: unknown };
    const identity = await verifyLineIdToken(typeof idToken === "string" ? idToken : "");
    if (!identity) return NextResponse.json({ error: "LINE authentication failed." }, { status: 401 });

    if (!await hasUserLineIdColumn()) {
      return NextResponse.json({ error: "LINE LIFF approval is not enabled yet. Run upgrade_v9_line_liff_auth.sql first." }, { status: 400 });
    }

    const user = await getLineLinkedUser(identity.sub);
    if (!user) return NextResponse.json({ linked: false, displayName: identity.name || "" });
    if (user.role === "Vendor") {
      return NextResponse.json({ error: "This role cannot approve mobile stock transactions." }, { status: 403 });
    }

    return NextResponse.json({ linked: true, user });
  } catch (error) {
    console.error("LINE LIFF auth error:", error);
    return NextResponse.json({ error: "Unable to verify LINE account." }, { status: 400 });
  }
}
