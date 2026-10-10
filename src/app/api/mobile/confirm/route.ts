import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { isDepartmentScopeFailure } from "@/lib/api-response";
import { hasUserPinColumn, roleHasMenu, verifyUserPin, type AuthenticatedUser } from "@/lib/auth-utils";
import { resolveDepartmentForVerifiedUser } from "@/lib/department-context";
import { departmentsReady, isMissingDepartmentSchemaError, markDepartmentsNotReady } from "@/lib/departments-flag";
import { getLineLinkedUser, hasUserLineIdColumn, verifyLineIdToken } from "@/lib/line-liff-auth";
import { getDepartmentScope } from "@/lib/scoped-db";
import { runDispenseBatch, runReceiveBatch, StockBatchItem } from "@/lib/stock-transactions";

type MobileMode = "receive" | "dispense";

export const POST = trackRoute({ action: "mobile.confirm" }, async (request: Request, ctx) => {
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
    ctx.details = { mode, attemptedUser: username, count: batchItems.length, items: batchItems };

    if (mode !== "receive" && mode !== "dispense") {
      return NextResponse.json({ error: "Invalid mobile action." }, { status: 400 });
    }

    if (batchItems.length === 0) {
      return NextResponse.json({ error: "No items to submit." }, { status: 400 });
    }

    if (mode === "receive" && lineIdToken) {
      return NextResponse.json({ error: "Mobile receiving must be approved with username and PIN." }, { status: 400 });
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

    ctx.user = user;

    if (user.role === "Vendor") {
      return NextResponse.json({ error: "This role cannot approve mobile stock transactions." }, { status: 403 });
    }

    // Departments on: work in the approver's own (default) department. The identity was verified above by PIN / LINE;
    // the department is never taken from the request (no header, no body field), and "all departments" is not possible here.
    if (await departmentsReady()) {
      let scoped: AuthenticatedUser | null | undefined;
      try {
        scoped = await resolveDepartmentForVerifiedUser(user);
      } catch (e) {
        if (!isMissingDepartmentSchemaError(e)) return ctx.fail(e);
        markDepartmentsNotReady("mobile confirm lookup failed; using legacy path");
      }
      if (scoped === null) {
        return NextResponse.json({ error: "บัญชีนี้ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ" }, { status: 403 });
      }
      if (scoped) {
        user = scoped;
        ctx.user = user;
        // The role in this department can be Vendor even if the account is not (and vice versa for the global role).
        if (user.globalRole === "Vendor" || user.role === "Vendor") {
          return NextResponse.json({ error: "This role cannot approve mobile stock transactions." }, { status: 403 });
        }
      }
    }

    // Same menu RBAC as /api/receive and /api/dispense, so the mobile/LINE path cannot bypass it.
    if (!await roleHasMenu(user.role, mode)) {
      return NextResponse.json({ error: mode === "receive" ? "บัญชีนี้ไม่มีสิทธิ์รับเข้า" : "บัญชีนี้ไม่มีสิทธิ์เบิกจ่าย" }, { status: 403 });
    }

    const userAgent = request.headers.get("user-agent") || "Unknown";
    const ipAddress = request.headers.get("x-forwarded-for") || "Unknown";

    const result = mode === "receive"
      ? await runReceiveBatch(batchItems, user, { userAgent, ipAddress }, await getDepartmentScope(user))
      : await runDispenseBatch(batchItems, user, { userAgent, ipAddress }, await getDepartmentScope(user));

    return NextResponse.json({
      ...result,
      approver: {
        username: user.username,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error: unknown) {
    if (isDepartmentScopeFailure(error)) return ctx.fail(error);
    console.error("Mobile confirm error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = errorMessage.startsWith('REAGENT_INACTIVE') ? 409 : 400;
    return NextResponse.json({ error: errorMessage }, { status });
  }
});
