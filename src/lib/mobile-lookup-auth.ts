import { NextResponse } from "next/server";
import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth-utils";
import { resolveDepartmentForVerifiedUser } from "@/lib/department-context";
import { departmentsReady, isMissingDepartmentSchemaError, markDepartmentsNotReady } from "@/lib/departments-flag";
import { getLineLinkedUser, hasUserLineIdColumn, verifyLineIdToken } from "@/lib/line-liff-auth";

export const LINE_ID_TOKEN_HEADER = "x-line-id-token";

export type MobileLookupAuth =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; response: NextResponse };

const fail = (error: string, status: number): MobileLookupAuth => ({ ok: false, response: NextResponse.json({ error }, { status }) });

const VENDOR_MESSAGE = "This role cannot approve mobile stock transactions.";
const NO_DEPARTMENT_MESSAGE = "บัญชีนี้ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ";
const VERIFY_FAILED_MESSAGE = "Unable to verify your account.";

/**
 * Signs in a read-only mobile lookup request and fixes its department.
 *
 * Identity: a LINE id token in the x-line-id-token header (the session is then ignored), otherwise the web session.
 * Department: never taken from the request. With departments on, the user's own default department is resolved from
 * the database (never "ALL", whatever the session says). With departments off, only the plain identity fields are
 * returned so a later getDepartmentScope cannot see a stale scope.
 */
export async function authenticateMobileLookup(request: Request): Promise<MobileLookupAuth> {
  const lineIdToken = (request.headers.get(LINE_ID_TOKEN_HEADER) || "").trim();
  const viaLine = lineIdToken !== "";

  let user: AuthenticatedUser | null;
  try {
    if (viaLine) {
      const identity = await verifyLineIdToken(lineIdToken);
      if (!identity) return fail("LINE authentication failed.", 401);
      if (!await hasUserLineIdColumn()) {
        return fail("LINE LIFF approval is not enabled yet. Run upgrade_v9_line_liff_auth.sql first.", 400);
      }
      user = await getLineLinkedUser(identity.sub);
      if (!user) return fail("This LINE account is not linked to a LabStock user.", 401);
    } else {
      user = await getAuthenticatedUser(request);
      if (!user) return fail("Please sign in.", 401);
    }
  } catch (error) {
    console.error("Mobile lookup sign-in failed:", error);
    return fail(VERIFY_FAILED_MESSAGE, 500);
  }

  if (user.role === "Vendor" || user.globalRole === "Vendor") return fail(VENDOR_MESSAGE, 403);

  if (await departmentsReady()) {
    let scoped: AuthenticatedUser | null | undefined;
    try {
      scoped = await resolveDepartmentForVerifiedUser(user);
    } catch (error) {
      if (!isMissingDepartmentSchemaError(error)) {
        console.error("Mobile lookup department resolution failed:", error);
        return fail(VERIFY_FAILED_MESSAGE, 500);
      }
      markDepartmentsNotReady("mobile lookup department resolution failed; using legacy path");
    }
    if (scoped === null) {
      return viaLine ? fail(NO_DEPARTMENT_MESSAGE, 403) : fail("Please sign in.", 401);
    }
    if (scoped) {
      // The role in this department can be Vendor even if the account's global role is not.
      if (scoped.role === "Vendor" || scoped.globalRole === "Vendor") return fail(VENDOR_MESSAGE, 403);
      return { ok: true, user: scoped };
    }
  }

  return { ok: true, user: { username: user.username, name: user.name, role: user.role, vendor: user.vendor } };
}
