import { NextResponse } from "next/server";
import { hasUserPinColumn, verifyUserPin } from "@/lib/auth-utils";
import { getLineLinkedUser, hasUserLineIdColumn, verifyLineIdToken } from "@/lib/line-liff-auth";
import { runDispenseBatch, runReceiveBatch, StockBatchItem } from "@/lib/stock-transactions";

type MobileMode = "receive" | "dispense";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      mode?: MobileMode;
      username?: string;
      pin?: string;
      lineIdToken?: string;
      batchItems?: StockBatchItem[];
    };

    const mode = body.mode;
    const username = String(body.username || "").trim();
    const pin = String(body.pin || "").trim();
    const lineIdToken = String(body.lineIdToken || "").trim();
    const batchItems = Array.isArray(body.batchItems) ? body.batchItems : [];

    if (mode !== "receive" && mode !== "dispense") {
      return NextResponse.json({ error: "Invalid mobile action." }, { status: 400 });
    }

    if (batchItems.length === 0) {
      return NextResponse.json({ error: "No items to submit." }, { status: 400 });
    }

    let user = null;
    if (lineIdToken) {
      const identity = await verifyLineIdToken(lineIdToken);
      if (!identity) return NextResponse.json({ error: "LINE authentication failed." }, { status: 401 });
      if (!await hasUserLineIdColumn()) {
        return NextResponse.json({ error: "LINE LIFF approval is not enabled yet. Run upgrade_v9_line_liff_auth.sql first." }, { status: 400 });
      }
      user = await getLineLinkedUser(identity.sub);
    } else {
      if (!username || !pin) {
        return NextResponse.json({ error: "Username and PIN are required." }, { status: 400 });
      }
      const pinEnabled = await hasUserPinColumn();
      if (!pinEnabled) {
        return NextResponse.json({ error: "PIN support is not enabled yet. Run upgrade_v5_user_pin.sql first." }, { status: 400 });
      }
      user = await verifyUserPin(username, pin);
    }

    if (!user) {
      return NextResponse.json({ error: lineIdToken ? "This LINE account is not linked to a LabStock user." : "Invalid username or PIN." }, { status: 401 });
    }

    if (user.role === "Vendor") {
      return NextResponse.json({ error: "This role cannot approve mobile stock transactions." }, { status: 403 });
    }

    const userAgent = request.headers.get("user-agent") || "Unknown";
    const ipAddress = request.headers.get("x-forwarded-for") || "Unknown";

    const result = mode === "receive"
      ? await runReceiveBatch(batchItems, user, { userAgent, ipAddress })
      : await runDispenseBatch(batchItems, user, { userAgent, ipAddress });

    return NextResponse.json({
      ...result,
      approver: {
        username: user.username,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error: unknown) {
    console.error("Mobile confirm error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
