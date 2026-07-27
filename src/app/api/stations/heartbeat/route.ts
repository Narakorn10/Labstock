import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedStation } from "@/lib/station-auth";

interface HeartbeatPayload {
  agentVersion: string;
  queuePending: number;
  queueConflict: number;
  lastScanAt: string | null;
}

function parseHeartbeatPayload(value: unknown): HeartbeatPayload | null {
  if (!value || typeof value !== "object") return null;

  const payload = value as Record<string, unknown>;
  const agentVersion = typeof payload.agent_version === "string" ? payload.agent_version.trim() : "";
  const queuePending = payload.queue_pending;
  const queueConflict = payload.queue_conflict;
  const lastScanAt = payload.last_scan_at;

  if (!agentVersion || agentVersion.length > 50 ||
    !Number.isSafeInteger(queuePending) || (queuePending as number) < 0 ||
    !Number.isSafeInteger(queueConflict) || (queueConflict as number) < 0) {
    return null;
  }

  if (lastScanAt !== null && lastScanAt !== undefined &&
    (typeof lastScanAt !== "string" || Number.isNaN(Date.parse(lastScanAt)))) {
    return null;
  }

  return {
    agentVersion,
    queuePending: queuePending as number,
    queueConflict: queueConflict as number,
    lastScanAt: typeof lastScanAt === "string" ? lastScanAt : null,
  };
}

export async function POST(request: Request) {
  try {
    const station = await getAuthenticatedStation(request);
    if (!station) return NextResponse.json({ error: "Unauthorized station." }, { status: 401 });

    const payload = parseHeartbeatPayload(await request.json());
    if (!payload) return NextResponse.json({ error: "Invalid heartbeat payload." }, { status: 400 });

    await sql`
      INSERT INTO station_heartbeats (
        station_id, agent_version, queue_pending, queue_conflict, last_scan_at, received_at
      ) VALUES (
        ${station.stationId}, ${payload.agentVersion}, ${payload.queuePending},
        ${payload.queueConflict}, ${payload.lastScanAt}, NOW()
      )
      ON CONFLICT (station_id) DO UPDATE SET
        agent_version = EXCLUDED.agent_version,
        queue_pending = EXCLUDED.queue_pending,
        queue_conflict = EXCLUDED.queue_conflict,
        last_scan_at = EXCLUDED.last_scan_at,
        received_at = NOW()
    `;

    return NextResponse.json({ status: "OK" });
  } catch (error: unknown) {
    console.error("Station heartbeat error:", error);
    return NextResponse.json({ error: "Unable to record station heartbeat." }, { status: 500 });
  }
}
