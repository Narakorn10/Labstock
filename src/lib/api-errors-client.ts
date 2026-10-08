import { ERROR_CATALOGUE, getErrorDef, isErrorCode } from "@/lib/errors";

/** Client-safe description of an API failure, ready to show to Thai-speaking users. */
export interface ApiErrorInfo {
  message: string;
  hint?: string;
  code: string;
  requestId?: string;
  status?: number;
  extra?: Record<string, unknown>;
}

const GENERIC_HINT = "ลองใหม่อีกครั้ง ถ้ายังเป็นอีกให้แจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิง";
const KNOWN_BODY_KEYS = new Set(["error", "message", "code", "hint", "requestId", "success"]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseApiError(err: unknown, fallback: string): ApiErrorInfo {
  if (!isRecord(err)) return { message: fallback, hint: GENERIC_HINT, code: "UNKNOWN" };

  const response = isRecord(err.response) ? err.response : undefined;
  const isAxios = err.isAxiosError === true || response !== undefined;

  if (response) {
    const status = typeof response.status === "number" ? response.status : undefined;
    const body = isRecord(response.data) ? response.data : undefined;
    const message = asString(body?.error) ?? asString(body?.message) ?? fallback;
    const rawCode = asString(body?.code);
    const code = rawCode ?? "UNKNOWN";
    const hint = asString(body?.hint) ?? (rawCode && isErrorCode(rawCode) ? getErrorDef(rawCode).hint : GENERIC_HINT);
    const requestId = asString(body?.requestId);
    const extra: Record<string, unknown> = {};
    if (body) {
      for (const [key, value] of Object.entries(body)) {
        if (!KNOWN_BODY_KEYS.has(key)) extra[key] = value;
      }
    }
    return {
      message,
      hint,
      code,
      ...(requestId ? { requestId } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    };
  }

  if (isAxios) {
    const axiosCode = asString(err.code);
    const key = axiosCode === "ECONNABORTED" || axiosCode === "ETIMEDOUT" ? "TIMEOUT" : "NETWORK_OFFLINE";
    const def = ERROR_CATALOGUE[key];
    return { message: def.message, hint: key === "NETWORK_OFFLINE" ? "ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่" : def.hint, code: key };
  }

  // Plain Error: only messages we wrote ourselves in Thai are shown; never raw technical English.
  const ownMessage = asString(err.message);
  if (ownMessage && /[฀-๿]/.test(ownMessage)) return { message: ownMessage, hint: GENERIC_HINT, code: "UNKNOWN" };
  return { message: fallback, hint: GENERIC_HINT, code: "UNKNOWN" };
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  return parseApiError(err, fallback).message;
}

/** For code that uses fetch() instead of axios: wrap a non-OK response so it can go through parseApiError / notifyApiError. */
export function fetchErrorShape(status: number, body: unknown): unknown {
  return { isAxiosError: true, response: { status, data: body } };
}
