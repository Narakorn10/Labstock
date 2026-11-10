import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { requireSuperAdmin } from "@/lib/super-admin";

// Tells the Super admin pages whether the caller may see them. Answers only { superAdmin: true } (or 401 / 403):
// it never returns user fields. The real check is repeated by every Super admin API through requireSuperAdmin.
export const GET = trackRoute({ action: "super_admin.status" }, async (request: Request, ctx) => {
  try {
    const caller = await requireSuperAdmin(request, ctx, { write: false });
    if (caller instanceof Response) return caller;
    return NextResponse.json({ superAdmin: true });
  } catch (error) {
    return ctx.fail(error);
  }
});
