import { NextResponse } from "next/server";
import { AppError, getErrorDef, type ErrorCode } from "./errors";
import { CountConfirmError } from "./count-work-orders";
import { PurchaseOrderCreationError } from "./purchase-order-creation";

/**
 * Server-side error responses. The body keeps `error` as a Thai string (existing clients read `{ error }`)
 * and adds code / hint / requestId. Raw exception text is never put in the body.
 */

export interface ApiErrorBody {
  error: string;
  code: string;
  hint: string;
  requestId: string;
  [key: string]: unknown;
}

export function apiError(
  code: ErrorCode,
  opts: { requestId: string; message?: string; hint?: string; status?: number; extra?: Record<string, unknown> },
): NextResponse<ApiErrorBody> {
  const def = getErrorDef(code);
  const body: ApiErrorBody = {
    ...(opts.extra ?? {}),
    error: opts.message ?? def.message,
    code,
    hint: opts.hint ?? def.hint,
    requestId: opts.requestId,
  };
  const response = NextResponse.json(body, { status: opts.status ?? def.status });
  response.headers.set("x-request-id", opts.requestId);
  return response;
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return typeof err === "string" ? err : JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

function sqlState(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

function isConnectionFailure(err: unknown, message: string): boolean {
  const state = sqlState(err);
  if (state && (state.startsWith("08") || state.startsWith("57P"))) return true;
  const name = err instanceof Error ? err.name : "";
  if (name === "NeonDbError" && /fetch failed|connect|timeout/i.test(message)) return true;
  return /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|Error connecting to database/i.test(message);
}

// Legacy system-written messages look like "CODE: itemId" (labstock_assert) or "CODE:itemId" (trigger).
// Only a plain item-id-looking token is echoed; anything else is dropped.
function legacyItemId(message: string, code: string): string | null {
  const match = message.slice(code.length).match(/^:\s*([A-Za-z0-9._-]{1,64})\s*$/);
  return match ? match[1] : null;
}

/**
 * Maps a DepartmentScopeError (scoped-db.ts) to the catalogue response; null for anything else.
 * Duck-typed on name/code so this file does not import scoped-db (which imports this file).
 * DEPARTMENT_SCOPE_MISSING (and any unknown code) becomes a plain 500: the raw message may name the user.
 */
export function departmentScopeErrorResponse(err: unknown, requestId: string): NextResponse<ApiErrorBody> | null {
  if (!(err instanceof Error) || err.name !== "DepartmentScopeError") return null;
  const code = (err as { code?: unknown }).code;
  if (code === "DEPARTMENT_NOT_FOUND") return apiError("DEPARTMENT_NOT_FOUND", { requestId });
  if (code === "DEPARTMENT_READ_ONLY") return apiError("DEPARTMENT_READ_ONLY", { requestId });
  return apiError("INTERNAL_ERROR", { requestId });
}

/** True when the failure means "this item/department combination is not allowed" (route should answer via the catalogue). */
export function isDepartmentScopeFailure(err: unknown): boolean {
  if (err instanceof Error && err.name === "DepartmentScopeError") return true;
  if (err instanceof AppError && err.code === "ITEM_NOT_IN_DEPARTMENT") return true;
  try {
    return rawMessage(err).startsWith("ITEM_NOT_IN_DEPARTMENT");
  } catch {
    return false;
  }
}

function classify(err: unknown, requestId: string, message: string): NextResponse<ApiErrorBody> {
  if (err instanceof AppError) {
    return apiError(err.code, { requestId, message: err.userMessage, hint: err.hint, extra: err.extra });
  }
  const dept = departmentScopeErrorResponse(err, requestId);
  if (dept) return dept;
  if (err instanceof CountConfirmError) {
    return apiError("COUNT_NOTHING_TO_DISPENSE", {
      requestId,
      extra: { failed: err.failed, remaining: err.remaining },
    });
  }
  if (err instanceof PurchaseOrderCreationError) {
    const code: ErrorCode = err.status === 404 ? "PO_NOT_FOUND" : err.status === 409 ? "PO_STATE_CONFLICT" : "VALIDATION_FAILED";
    return apiError(code, { requestId, status: err.status });
  }
  if (message.startsWith("REAGENT_INACTIVE")) {
    const itemId = legacyItemId(message, "REAGENT_INACTIVE");
    return apiError("REAGENT_INACTIVE", { requestId, ...(itemId ? { message: `สารเคมีรายการนี้ถูกปิดใช้งานแล้ว (${itemId})` } : {}) });
  }
  if (message.startsWith("REAGENT_STOCK_INSUFFICIENT")) {
    const itemId = legacyItemId(message, "REAGENT_STOCK_INSUFFICIENT");
    return apiError("REAGENT_STOCK_INSUFFICIENT", { requestId, ...(itemId ? { message: `จำนวนคงเหลือไม่พอสำหรับรายการที่เบิก (${itemId})` } : {}) });
  }
  if (message.startsWith("ITEM_NOT_IN_DEPARTMENT")) {
    const itemId = legacyItemId(message, "ITEM_NOT_IN_DEPARTMENT");
    return apiError("ITEM_NOT_IN_DEPARTMENT", { requestId, ...(itemId ? { message: `รายการนี้ไม่อยู่ในงานของคุณ (${itemId})` } : {}) });
  }
  if (err instanceof SyntaxError) return apiError("INVALID_JSON", { requestId });
  if (sqlState(err) === "23505") return apiError("DUPLICATE_ENTRY", { requestId });
  if (isConnectionFailure(err, message)) return apiError("DB_UNAVAILABLE", { requestId });
  return apiError("INTERNAL_ERROR", { requestId });
}

/**
 * Turns any thrown value into a safe response. `internalMessage` carries the real cause
 * for logs / app_events only. Never throws.
 */
export function toApiError(err: unknown, requestId: string): { response: NextResponse<ApiErrorBody>; internalMessage: string } {
  let internalMessage = "";
  try {
    internalMessage = rawMessage(err);
    console.error(`[api-error] ${requestId}:`, err);
    return { response: classify(err, requestId, internalMessage), internalMessage };
  } catch {
    return { response: apiError("INTERNAL_ERROR", { requestId }), internalMessage: internalMessage || "unknown error" };
  }
}
