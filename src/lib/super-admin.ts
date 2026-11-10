import sql from "@/lib/db";
import { apiError } from "@/lib/api-response";
import type { TrackContext } from "@/lib/app-events";
import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth-utils";
import { isMissingDepartmentSchemaError } from "@/lib/departments-flag";
import { isCrossOrigin } from "@/lib/room-route";

// Super admin = a global Admin (users.role) who also carries users.is_super_admin (v37) and is active.
// It is a separate flag on purpose: that person keeps role 'Admin', so every existing Admin check is untouched.
// The answer always comes from the database, never from the session/token the client holds.

/** True only for an active global Admin with the flag. A missing column (v37 not applied yet) means false, never an error. */
export async function isSuperAdmin(username: string): Promise<boolean> {
  try {
    const rows = await sql`
      SELECT 1
      FROM users
      WHERE username = ${username} AND role = 'Admin' AND is_super_admin = true AND account_status = 'active'
      LIMIT 1
    `;
    return rows.length > 0;
  } catch (error) {
    if (isMissingDepartmentSchemaError(error)) return false;
    throw error;
  }
}

/**
 * Gate for Super admin routes. Order: cross-origin (writes only), signed in, Super admin.
 * Returns the user, or the error response to send back (401 AUTH_REQUIRED / 403 FORBIDDEN).
 */
export async function requireSuperAdmin(
  request: Request,
  ctx: TrackContext,
  options: { write: boolean },
): Promise<AuthenticatedUser | Response> {
  if (options.write && isCrossOrigin(request)) return apiError("FORBIDDEN", { requestId: ctx.requestId });

  const user = await getAuthenticatedUser(request);
  if (!user) return apiError("AUTH_REQUIRED", { requestId: ctx.requestId });
  ctx.user = user;

  if (!await isSuperAdmin(user.username)) return apiError("FORBIDDEN", { requestId: ctx.requestId });
  return user;
}
