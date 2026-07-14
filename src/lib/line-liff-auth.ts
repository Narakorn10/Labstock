import sql from "@/lib/db";
import { AuthenticatedUser } from "@/lib/auth-utils";

const LINE_ID_TOKEN_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

type VerifiedLineIdentity = {
  sub: string;
  name?: string;
};

function getLineChannelId() {
  const configuredId = process.env.LINE_LIFF_CHANNEL_ID?.trim();
  if (configuredId) return configuredId;

  const liffId = process.env.NEXT_PUBLIC_LINE_DISPENSE_LIFF_ID?.trim();
  return liffId?.split("-")[0] || "";
}

export async function hasUserLineIdColumn() {
  const result = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'line_user_id'
    ) AS exists
  `;

  return Boolean(result[0]?.exists);
}

export async function verifyLineIdToken(idToken: string): Promise<VerifiedLineIdentity | null> {
  const channelId = getLineChannelId();
  if (!channelId || !idToken) return null;

  try {
    const response = await fetch(LINE_ID_TOKEN_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      cache: "no-store",
    });

    if (!response.ok) return null;
    const data = await response.json() as { sub?: unknown; name?: unknown };
    if (typeof data.sub !== "string" || !data.sub.trim()) return null;

    return {
      sub: data.sub,
      name: typeof data.name === "string" ? data.name : undefined,
    };
  } catch (error) {
    console.error("LINE ID token verification failed:", error);
    return null;
  }
}

export async function getLineLinkedUser(lineUserId: string): Promise<AuthenticatedUser | null> {
  const users = await sql`
    SELECT username, name, role, vendor
    FROM users
    WHERE line_user_id = ${lineUserId}
    LIMIT 1
  `;

  if (users.length === 0) return null;
  const user = users[0];
  return {
    username: user.username,
    name: user.name,
    role: user.role,
    vendor: user.vendor,
  };
}
