import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import sql from './db';
import { resolveUserDepartment, type RequestedDepartment } from './department-context';
import { departmentsReady, isMissingDepartmentSchemaError, markDepartmentsNotReady } from './departments-flag';

const SALT_ROUNDS = 10;

export interface AuthenticatedUser {
  username: string;
  name: string;
  /** Effective role. Without departments this is users.role; with departments it is the role in the selected department. */
  role: string;
  vendor?: string;
  /** users.role. Only set by the department-aware path. */
  globalRole?: string;
  /** Selected department. null for legacy (departments off / not ready) or for "ALL". */
  departmentId?: number | null;
  departmentCode?: string | null;
  /** null = legacy, no department filtering. "ALL" = Admin viewing every department (read only). */
  scope?: number | 'ALL' | null;
  /** The caller asked (X-Department-Id) for a department the user is not in. Routes answer 404. */
  departmentDenied?: true;
}

/** X-Department-Id: digits or "ALL". Anything else is invalid (and the request is denied). */
function parseDepartmentHeader(value: string | null): { requested: RequestedDepartment; explicit: boolean; invalid: boolean } {
  if (value === null) return { requested: null, explicit: false, invalid: false };
  const trimmed = value.trim();
  if (trimmed === 'ALL') return { requested: 'ALL', explicit: true, invalid: false };
  if (/^\d{1,9}$/.test(trimmed)) return { requested: Number(trimmed), explicit: true, invalid: false };
  return { requested: null, explicit: true, invalid: true };
}

/** The department stored in the Auth.js token by the (future) session switcher. Absent or malformed = default. */
function parseSessionDepartment(value: unknown): RequestedDepartment {
  if (value === 'ALL') return 'ALL';
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export async function hashPassword(password: string) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string) {
  // 1. Try Bcrypt (Modern)
  try {
    if (hash.startsWith('$2')) {
      return await bcrypt.compare(password, hash);
    }
  } catch {
    // Bcrypt comparison failed, likely not a bcrypt hash
  }

  // 2. Try SHA-256 (Legacy fallback for migration)
  const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
  return sha256Hash === hash;
}

export function isLegacyPasswordHash(hash: string) {
  return !hash.startsWith('$2');
}

/**
 * Re-hashes a legacy unsalted SHA-256 password with bcrypt after a successful
 * login. Call only once the password has been verified. Never throws, so a
 * failed upgrade cannot block the login.
 */
export async function upgradeLegacyPasswordHash(username: string, password: string, currentHash: string) {
  if (!isLegacyPasswordHash(currentHash)) return;

  try {
    const newHash = await hashPassword(password);
    // Matching the old hash avoids overwriting a password changed in the meantime.
    await sql`
      UPDATE users
      SET password_hash = ${newHash}
      WHERE username = ${username} AND password_hash = ${currentHash}
    `;
  } catch (error) {
    console.error('Legacy password hash upgrade failed:', error);
  }
}

export async function hashPin(pin: string) {
  return await bcrypt.hash(pin, SALT_ROUNDS);
}

export async function hasUserPinColumn() {
  const result = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'pin_hash'
    ) as exists
  `;

  return Boolean(result[0]?.exists);
}

export async function hasUserDepartmentColumn() {
  const result = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'department'
    ) as exists
  `;

  return Boolean(result[0]?.exists);
}

export async function hasUserAccountStatusColumn() {
  const result = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'account_status'
    ) as exists
  `;

  return Boolean(result[0]?.exists);
}

export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  // Auth.js sessions are the primary web authentication path. Bearer tokens
  // remain below only so existing mobile/LIFF clients are not logged out during
  // the staged migration.
  try {
    const { auth } = await import('@/auth');
    const session = await auth();
    const sessionUser = session?.user as (AuthenticatedUser & { username?: string; sessionVersion?: number; activeDepartmentId?: unknown }) | undefined;
    if (sessionUser?.username && sessionUser.role) {
      if (await departmentsReady()) {
        try {
          // One query replaces the schema probe + session check. The X-Department-Id header is NOT honored here:
          // a browser session only changes department through the signed Auth.js token.
          return await resolveUserDepartment({
            username: sessionUser.username,
            sessionVersion: sessionUser.sessionVersion,
            requested: parseSessionDepartment(sessionUser.activeDepartmentId),
            explicit: false,
          });
        } catch (error) {
          if (!isMissingDepartmentSchemaError(error)) throw error;
          markDepartmentsNotReady(`session lookup failed (${(error as { code?: string }).code}); using legacy path`);
        }
      }
      const { isCurrentAuthSession } = await import('@/lib/auth-service');
      if (!await isCurrentAuthSession(sessionUser.username, sessionUser.sessionVersion)) {
        return null;
      }
      return {
        username: sessionUser.username,
        name: sessionUser.name || sessionUser.username,
        role: sessionUser.role,
        vendor: sessionUser.vendor,
      };
    }
  } catch (error) {
    console.error('Auth.js session check error:', error);
  }

  const authHeader = request.headers.get('Authorization');
  const bearerMatch = authHeader?.match(/^Bearer[ \t]+([^ \t\r\n]+)$/i);
  if (!bearerMatch || bearerMatch[1].length > 1024) {
    return null;
  }

  const token = bearerMatch[1];
  
  try {
    // Hash the token from request to compare with hashed token in DB
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    if (await departmentsReady()) {
      try {
        const header = parseDepartmentHeader(request.headers.get('X-Department-Id'));
        const resolved = await resolveUserDepartment({
          token,
          tokenHash: hashedToken,
          requested: header.requested,
          explicit: header.explicit,
        });
        if (resolved && header.invalid) resolved.departmentDenied = true;
        return resolved;
      } catch (error) {
        if (!isMissingDepartmentSchemaError(error)) throw error;
        markDepartmentsNotReady(`bearer lookup failed (${(error as { code?: string }).code}); using legacy path`);
      }
    }

    const hasAccountStatus = await hasUserAccountStatusColumn();

    const users = hasAccountStatus
      ? await sql`
          SELECT username, name, role, vendor, token_expiry, account_status
          FROM users
          WHERE (token = ${token} OR token = ${hashedToken})
          LIMIT 1
        `
      : await sql`
          SELECT username, name, role, vendor, token_expiry
          FROM users
          WHERE (token = ${token} OR token = ${hashedToken})
          LIMIT 1
        `;

    if (users.length === 0) return null;

    const user = users[0];

    // Before the migration the column is absent and legacy tokens remain valid.
    // Once it exists, only explicitly active accounts can use a bearer token.
    if (hasAccountStatus && user.account_status !== 'active') {
      return null;
    }

    // Check expiry
    if (user.token_expiry && new Date(user.token_expiry) < new Date()) {
      return null; // Token expired
    }

    return {
      username: user.username,
      name: user.name,
      role: user.role,
      vendor: user.vendor
    };
  } catch (error) {
    console.error('Auth check error:', error);
    return null;
  }
}

export async function verifyUserPin(username: string, pin: string): Promise<AuthenticatedUser | null> {
  try {
    const pinEnabled = await hasUserPinColumn();
    if (!pinEnabled) return null;
    const hasAccountStatus = await hasUserAccountStatusColumn();

    const users = hasAccountStatus
      ? await sql`
          SELECT username, name, role, vendor, pin_hash, account_status
          FROM users
          WHERE LOWER(username) = LOWER(${username.trim()})
          LIMIT 1
        `
      : await sql`
          SELECT username, name, role, vendor, pin_hash
          FROM users
          WHERE LOWER(username) = LOWER(${username.trim()})
          LIMIT 1
        `;

    if (users.length === 0) return null;

    const user = users[0];
    if (hasAccountStatus && user.account_status !== 'active') return null;
    if (!user.pin_hash) return null;

    const isMatch = await comparePassword(pin, user.pin_hash);
    if (!isMatch) return null;

    return {
      username: user.username,
      name: user.name,
      role: user.role,
      vendor: user.vendor
    };
  } catch (error) {
    console.error('PIN verification error:', error);
    return null;
  }
}

export async function isAdmin(request: Request) {
  const user = await getAuthenticatedUser(request);
  return user?.role === 'Admin';
}

/** Returns true when the role may use a menu-scoped feature. Admin always may; any lookup error denies. */
export async function roleHasMenu(role: string, menuId: string) {
  if (role === 'Admin') return true;

  try {
    const rows = await sql`
      SELECT allowed_menus
      FROM role_permissions
      WHERE role = ${role}
      LIMIT 1
    `;
    const allowedMenus = Array.isArray(rows[0]?.allowed_menus) ? rows[0].allowed_menus as string[] : [];
    return allowedMenus.includes(menuId);
  } catch (error) {
    console.error('RBAC permission check failed:', error);
    return false;
  }
}

/** Returns true when the authenticated user may manage a menu-scoped feature. */
export async function hasMenuPermission(request: Request, menuId: string) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { user: null, allowed: false };
  return { user, allowed: await roleHasMenu(user.role, menuId) };
}

export async function canManageBarcodeLearningV2(request: Request) {
  return hasMenuPermission(request, 'barcodes');
}
