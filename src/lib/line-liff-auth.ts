import sql from "@/lib/db";
import { AuthenticatedUser } from "@/lib/auth-utils";

const LINE_ID_TOKEN_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

type VerifiedLineIdentity = {
  sub: string;
  name?: string;
};

function getLineChannelIds() {
  const candidates = [
    process.env.LINE_LIFF_CHANNEL_ID?.trim(),
    process.env.NEXT_PUBLIC_LINE_ORDER_LIFF_ID?.trim().split("-")[0],
    process.env.NEXT_PUBLIC_LINE_DISPENSE_LIFF_ID?.trim().split("-")[0],
  ].filter((candidate): candidate is string => Boolean(candidate));

  return Array.from(new Set(candidates));
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
  const channelIds = getLineChannelIds();
  if (!channelIds.length || !idToken) return null;

  for (const channelId of channelIds) {
    try {
      const response = await fetch(LINE_ID_TOKEN_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
        cache: "no-store",
      });

      if (!response.ok) continue;
      const data = await response.json() as { sub?: unknown; name?: unknown };
      if (typeof data.sub !== "string" || !data.sub.trim()) continue;

      return {
        sub: data.sub,
        name: typeof data.name === "string" ? data.name : undefined,
      };
    } catch (error) {
      console.error("LINE ID token verification failed:", error);
    }
  }

  return null;
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

export async function getLineLinkedPurchasingUser(lineUserId: string): Promise<AuthenticatedUser | null> {
  const user = await getLineLinkedUser(lineUserId);
  if (!user || (user.role !== "Admin" && user.role !== "Manager")) return null;
  return user;
}
