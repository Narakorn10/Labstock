import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import sql from './db';

const SALT_ROUNDS = 10;

export interface AuthenticatedUser {
  username: string;
  name: string;
  role: string;
  vendor?: string;
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

export async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  
  try {
    // Hash the token from request to compare with hashed token in DB
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const users = await sql`
      SELECT username, name, role, vendor, token_expiry 
      FROM users 
      WHERE (token = ${token} OR token = ${hashedToken})
      LIMIT 1
    `;

    if (users.length === 0) return null;

    const user = users[0];

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

    const users = await sql`
      SELECT username, name, role, vendor, pin_hash
      FROM users
      WHERE LOWER(username) = LOWER(${username.trim()})
      LIMIT 1
    `;

    if (users.length === 0) return null;

    const user = users[0];
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
