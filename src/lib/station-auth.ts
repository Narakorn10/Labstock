import crypto from "crypto";
import sql from "@/lib/db";

export interface AuthenticatedStation {
  stationId: string;
  stationName: string;
}

export async function getAuthenticatedStation(request: Request): Promise<AuthenticatedStation | null> {
  const stationId = request.headers.get("x-station-id")?.trim();
  const authorization = request.headers.get("authorization");

  if (!stationId || !authorization?.startsWith("Bearer ")) return null;

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return null;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const rows = await sql`
    SELECT s.station_id, s.station_name
    FROM stations s
    JOIN station_tokens t ON t.station_id = s.station_id
    WHERE s.station_id = ${stationId}
      AND s.status = 'ACTIVE'
      AND t.token_hash = ${tokenHash}
      AND t.is_active = TRUE
      AND t.revoked_at IS NULL
      AND (t.expires_at IS NULL OR t.expires_at > NOW())
    LIMIT 1
  `;

  const station = rows[0];
  return station
    ? { stationId: String(station.station_id), stationName: String(station.station_name) }
    : null;
}
