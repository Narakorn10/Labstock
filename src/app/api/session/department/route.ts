import { NextResponse } from "next/server";
import { unstable_update } from "@/auth";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { parseRequestedDepartment, validateDepartmentSwitch } from "@/lib/department-switch";
import { departmentsReady, isMissingDepartmentSchemaError, markDepartmentsNotReady } from "@/lib/departments-flag";

// A browser sends Origin on cross-site POSTs; when it is present it must be this very host (CSRF defence in depth on
// top of the SameSite session cookie). Requests without Origin (curl, server-to-server) are not affected.
function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // "null" or garbage
  }
}

// Switch the working department of a browser (Auth.js cookie) session. sessionVersion is deliberately NOT bumped:
// the choice is per device, and revocation is enforced by the membership check on every request.
export const POST = trackRoute({ action: "session.department" }, async (request: Request, ctx) => {
  try {
    // Bearer clients (mobile / LIFF) pick a department per request with X-Department-Id instead.
    if (request.headers.get("Authorization")) {
      return apiError("VALIDATION_FAILED", {
        requestId: ctx.requestId,
        message: "การสลับงานใช้ได้กับการเข้าสู่ระบบผ่านเว็บเท่านั้น",
        hint: "แอปมือถือให้ส่ง X-Department-Id ในแต่ละคำขอแทน",
      });
    }

    if (isCrossOrigin(request)) {
      return apiError("FORBIDDEN", { requestId: ctx.requestId });
    }
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return apiError("VALIDATION_FAILED", { requestId: ctx.requestId, message: "ต้องส่งข้อมูลแบบ application/json" });
    }

    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId: ctx.requestId });
    ctx.user = user;

    if (!await departmentsReady()) return apiError("DEPARTMENTS_DISABLED", { requestId: ctx.requestId });

    const body = await request.json() as { departmentId?: unknown };
    ctx.details = { departmentId: body?.departmentId };

    if (parseRequestedDepartment(body?.departmentId) === null) {
      return apiError("VALIDATION_FAILED", { requestId: ctx.requestId });
    }

    let target;
    try {
      target = await validateDepartmentSwitch(user.username, body?.departmentId);
    } catch (error) {
      if (!isMissingDepartmentSchemaError(error)) throw error;
      markDepartmentsNotReady(`department switch failed (${(error as { code?: string }).code}); using legacy path`);
      return apiError("DEPARTMENTS_DISABLED", { requestId: ctx.requestId });
    }
    if (!target) {
      // Not a member / inactive / ALL for a non-Admin / Vendor: all look the same to the caller.
      return apiError("DEPARTMENT_NOT_FOUND", { requestId: ctx.requestId });
    }

    // The jwt callback validates again before it writes the token (client-side update() reaches the same callback).
    // unstable_update returns the new session payload ({ user: { ..., activeDepartmentId }, expires }) or null when there
    // was no valid session cookie. The jwt callback leaves the token unchanged when it refuses the switch (for example
    // the membership was revoked a moment ago), so the new id must show up in the result, otherwise we did NOT switch.
    const updated = await unstable_update({ activeDepartmentId: target.activeDepartmentId } as never) as
      { user?: { activeDepartmentId?: unknown } } | null | undefined;
    if (updated?.user?.activeDepartmentId !== target.activeDepartmentId) {
      return apiError("DEPARTMENT_NOT_FOUND", { requestId: ctx.requestId });
    }
    return NextResponse.json({ success: true, department: target.department, scope: target.scope });
  } catch (error) {
    return ctx.fail(error);
  }
});
