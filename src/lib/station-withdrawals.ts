import crypto from "crypto";
import sql from "@/lib/db";

export interface StationWithdrawalItem {
  local_event_id: string;
  item_id: string;
  lot_no: string;
  quantity: number;
  expiry_date?: string | null;
  raw_barcode: string;
}

export interface StationWithdrawalPayload {
  schema_version: 1;
  idempotency_key: string;
  local_queue_id: string;
  local_session_id: string;
  authorization_token: string;
  occurred_at: string;
  items: StationWithdrawalItem[];
}

type WithdrawalResult = {
  status: "SYNCED" | "CONFLICT" | "REJECTED";
  server_transaction_id: string | null;
  duplicate: boolean;
  error_code: string | null;
  message: string;
};

const hasText = (value: unknown, maxLength: number) => (
  typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
);

export function parseStationWithdrawalPayload(value: unknown): StationWithdrawalPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;

  if (
    payload.schema_version !== 1 ||
    !hasText(payload.idempotency_key, 128) ||
    !hasText(payload.local_queue_id, 128) ||
    !hasText(payload.local_session_id, 128) ||
    !hasText(payload.authorization_token, 512) ||
    !hasText(payload.occurred_at, 64) ||
    Number.isNaN(Date.parse(String(payload.occurred_at))) ||
    !Array.isArray(payload.items) ||
    payload.items.length === 0 ||
    payload.items.length > 100
  ) return null;

  const items: StationWithdrawalItem[] = [];
  const eventIds = new Set<string>();
  for (const value of payload.items) {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (
      !hasText(item.local_event_id, 128) ||
      !hasText(item.item_id, 128) ||
      !hasText(item.lot_no, 128) ||
      !hasText(item.raw_barcode, 4096) ||
      typeof item.quantity !== "number" ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > 1_000_000 ||
      (item.expiry_date != null && (!hasText(item.expiry_date, 10) || Number.isNaN(Date.parse(String(item.expiry_date)))))
    ) return null;

    const localEventId = String(item.local_event_id).trim();
    if (eventIds.has(localEventId)) return null;
    eventIds.add(localEventId);

    items.push({
      local_event_id: localEventId,
      item_id: String(item.item_id).trim(),
      lot_no: String(item.lot_no).trim(),
      quantity: Number(item.quantity),
      expiry_date: typeof item.expiry_date === "string" ? item.expiry_date : null,
      raw_barcode: String(item.raw_barcode),
    });
  }

  return {
    schema_version: 1,
    idempotency_key: String(payload.idempotency_key).trim(),
    local_queue_id: String(payload.local_queue_id).trim(),
    local_session_id: String(payload.local_session_id).trim(),
    authorization_token: String(payload.authorization_token).trim(),
    occurred_at: String(payload.occurred_at).trim(),
    items,
  };
}

export async function syncStationWithdrawal(
  stationId: string,
  payload: StationWithdrawalPayload,
  audit: { userAgent: string; ipAddress: string }
): Promise<WithdrawalResult> {
  const authorizationHash = crypto.createHash("sha256").update(payload.authorization_token).digest("hex");
  const authorizations = await sql`
    SELECT u.username
    FROM station_user_authorizations a
    JOIN users u ON u.username = a.username
    WHERE a.station_id = ${stationId}
      AND a.token_hash = ${authorizationHash}
      AND a.revoked_at IS NULL
      AND a.expires_at > NOW()
    LIMIT 1
  `;
  const authorization = authorizations[0];
  if (!authorization) {
    return {
      status: "REJECTED",
      server_transaction_id: null,
      duplicate: false,
      error_code: "USER_AUTHORIZATION_INVALID",
      message: "User authorization is invalid or expired.",
    };
  }

  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const rows = await sql`
    SELECT *
    FROM process_station_withdrawal(
      ${stationId},
      ${payload.idempotency_key},
      ${payloadHash},
      ${payload.local_queue_id},
      ${payload.local_session_id},
      ${String(authorization.username)},
      ${payload.occurred_at}::timestamptz,
      ${JSON.stringify(payload.items)}::jsonb,
      ${audit.userAgent},
      ${audit.ipAddress}
    )
  `;

  const result = rows[0];
  if (!result) throw new Error("Station withdrawal did not return a result.");

  return {
    status: String(result.status) as WithdrawalResult["status"],
    server_transaction_id: result.server_transaction_id ? String(result.server_transaction_id) : null,
    duplicate: Boolean(result.duplicate),
    error_code: result.error_code ? String(result.error_code) : null,
    message: String(result.message),
  };
}
