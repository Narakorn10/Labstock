import { comparePassword, upgradeLegacyPasswordHash } from '@/lib/auth-utils';
import sql from '@/lib/db';

export type DatabaseAuthUser = {
  username: string;
  name: string;
  role: string;
  vendor?: string | null;
  email?: string | null;
  account_status?: string | null;
  session_version?: number | null;
  password_hash?: string;
};

type LoginSchemaState = {
  hasEmail: boolean;
  hasAccountStatus: boolean;
  hasSessionVersion: boolean;
};

async function getLoginSchemaState(): Promise<LoginSchemaState> {
  const columns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name IN ('email', 'account_status', 'session_version')
  `;

  const names = new Set(columns.map((column) => String(column.column_name)));
  return {
    hasEmail: names.has('email'),
    hasAccountStatus: names.has('account_status'),
    hasSessionVersion: names.has('session_version'),
  };
}

async function findUser(identifier: string, schema: LoginSchemaState): Promise<DatabaseAuthUser | null> {
  const users = schema.hasEmail
    ? await sql`
        SELECT username, password_hash, name, role, vendor, email${schema.hasAccountStatus ? sql`, account_status` : sql``}${schema.hasSessionVersion ? sql`, session_version` : sql``}
        FROM users
        WHERE LOWER(username) = LOWER(${identifier}) OR LOWER(email) = LOWER(${identifier})
        LIMIT 1
      `
    : await sql`
        SELECT username, password_hash, name, role, vendor${schema.hasAccountStatus ? sql`, account_status` : sql``}${schema.hasSessionVersion ? sql`, session_version` : sql``}
        FROM users
        WHERE LOWER(username) = LOWER(${identifier})
        LIMIT 1
      `;

  return (users[0] as DatabaseAuthUser | undefined) ?? null;
}

function isActive(user: DatabaseAuthUser, schema: LoginSchemaState) {
  return !schema.hasAccountStatus || (user.account_status ?? 'active') === 'active';
}

export async function validateCredentials(identifier: string, password: string): Promise<DatabaseAuthUser | null> {
  const normalizedIdentifier = identifier.trim();
  if (!normalizedIdentifier || !password) return null;

  const schema = await getLoginSchemaState();
  const user = await findUser(normalizedIdentifier, schema);
  if (!user || !user.password_hash || !isActive(user, schema)) return null;

  if (!await comparePassword(password, user.password_hash)) return null;

  await upgradeLegacyPasswordHash(user.username, password, user.password_hash);
  return user;
}

export async function findActiveUserByEmail(email: string): Promise<DatabaseAuthUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const schema = await getLoginSchemaState();
  if (!schema.hasEmail) return null;

  const users = await sql`
    SELECT username, name, role, vendor, email${schema.hasAccountStatus ? sql`, account_status` : sql``}${schema.hasSessionVersion ? sql`, session_version` : sql``}
    FROM users
    WHERE LOWER(email) = ${normalizedEmail}
    LIMIT 1
  `;
  const user = users[0] as DatabaseAuthUser | undefined;
  return user && isActive(user, schema) ? user : null;
}

export async function isCurrentAuthSession(username: string, sessionVersion: number | undefined): Promise<boolean> {
  const schema = await getLoginSchemaState();
  if (!schema.hasSessionVersion) return true;
  if (!Number.isInteger(sessionVersion)) return false;

  const users = schema.hasAccountStatus
    ? await sql`
        SELECT username
        FROM users
        WHERE username = ${username} AND account_status = 'active' AND session_version = ${sessionVersion}
        LIMIT 1
      `
    : await sql`
        SELECT username
        FROM users
        WHERE username = ${username} AND session_version = ${sessionVersion}
        LIMIT 1
      `;
  return users.length === 1;
}
