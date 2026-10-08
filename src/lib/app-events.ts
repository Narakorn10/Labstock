import sql from "./db";
import { toApiError } from "./api-response";
import { getRequestId } from "./request-observability";

/**
 * Activity log for important API actions: who did what, and why it failed.
 * Recording never throws and never changes the real transaction's result.
 */

export type AppEventOutcome = "success" | "rejected" | "error";

export interface AppEvent {
  requestId?: string | null;
  username?: string | null;
  role?: string | null;
  action: string;
  route: string;
  method?: string | null;
  status?: number | null;
  message?: string | null;
  details?: unknown;
  durationMs?: number | null;
}

const SCALAR_KEYS = [
  "itemId", "inventoryId", "lotNo", "qty", "countedQty", "workOrderId", "jobType",
  "poId", "poNumber", "status", "mode", "attemptedUser", "count",
];
const LIST_KEYS = ["items"];
const MAX_LIST_ITEMS = 50;
const MAX_STRING = 100;
const MAX_MESSAGE = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined;
}

function pickScalars(input: Record<string, unknown>) {
  const out: Record<string, string | number | boolean> = {};
  for (const key of SCALAR_KEYS) {
    const value = scalar(input[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Allowlist filter: only known, non-secret keys survive. Anything else (pin, password,
 * token, headers, free text...) is dropped, so it can never reach the database.
 */
export function summarizeDetails(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input)) return {};
  const out: Record<string, unknown> = pickScalars(input);
  for (const key of LIST_KEYS) {
    const list = input[key];
    if (!Array.isArray(list)) continue;
    out[key] = list.filter(isPlainObject).slice(0, MAX_LIST_ITEMS).map(pickScalars);
    out[`${key}Total`] = list.length;
  }
  return out;
}

export function classifyOutcome(status: number): AppEventOutcome {
  if (status >= 500) return "error";
  if (status >= 400) return "rejected";
  return "success";
}

let warnedMissingTable = false;

export async function recordAppEvent(event: AppEvent): Promise<void> {
  try {
    const status = event.status ?? null;
    const outcome = status === null ? "error" : classifyOutcome(status);
    await sql`
      INSERT INTO app_events (request_id, username, role, action, route, method, outcome, status, message, details, duration_ms)
      VALUES (
        ${event.requestId ?? null}, ${event.username ?? null}, ${event.role ?? null}, ${event.action}, ${event.route},
        ${event.method ?? null}, ${outcome}, ${status}, ${event.message ? event.message.slice(0, MAX_MESSAGE) : null},
        ${JSON.stringify(summarizeDetails(event.details))}::jsonb, ${event.durationMs ?? null}
      )
    `;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/app_events/.test(text) && /does not exist/.test(text)) {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.error("[app-events] table app_events is missing. Run scripts/apply-v28-app-events.mjs.");
      }
      return;
    }
    console.error("[app-events] failed to record event:", error);
  }
}

export interface TrackContext {
  user?: { username: string; role: string } | null;
  details?: unknown;
  /** Same id that is stored in the app_events row and returned in the x-request-id header. */
  requestId: string;
  /** Turns a caught error into a safe user-facing response; the real cause is kept for the log only. */
  fail(err: unknown): Response;
}

async function readErrorInfo(response: Response): Promise<{ message: string | null; code: string | null }> {
  try {
    const body = await response.clone().json() as { error?: unknown; message?: unknown; code?: unknown };
    const text = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : null;
    return { message: text, code: typeof body?.code === "string" ? body.code : null };
  } catch {
    return { message: null, code: null };
  }
}

function stamp(response: Response, requestId: string): Response {
  try {
    response.headers.set("x-request-id", requestId);
  } catch {
    // Immutable headers (e.g. a proxied response): the body-level requestId still identifies the request.
  }
  return response;
}

/**
 * Wraps a route handler and records one app_events row per request. The handler fills
 * `ctx.user` once it knows who the caller is (so there is no second session lookup) and
 * `ctx.details` with the raw input. An uncaught throw is logged and answered with a safe
 * error body; the raw exception text is only stored in app_events, never sent to the client.
 */
export function trackRoute<C = unknown>(
  meta: { action: string },
  handler: (request: Request, ctx: TrackContext, routeContext: C) => Promise<Response>,
) {
  return async (request: Request, routeContext?: C): Promise<Response> => {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    let internalMessage: string | undefined;
    const ctx: TrackContext = {
      requestId,
      fail(err: unknown) {
        const mapped = toApiError(err, requestId);
        internalMessage = mapped.internalMessage;
        return mapped.response;
      },
    };
    let response: Response;
    try {
      response = await handler(request, ctx, routeContext as C);
    } catch (error) {
      response = ctx.fail(error);
    }
    stamp(response, requestId);

    const status = response.status;
    let message: string | null = null;
    if (status >= 400) {
      const info = await readErrorInfo(response);
      const text = internalMessage ?? info.message;
      message = text ? (info.code && !text.startsWith(info.code) ? `${info.code}: ${text}` : text).slice(0, MAX_MESSAGE) : info.code;
    }
    await recordAppEvent({
      requestId,
      username: ctx.user?.username,
      role: ctx.user?.role,
      action: meta.action,
      route: new URL(request.url).pathname,
      method: request.method,
      status,
      message,
      details: ctx.details,
      durationMs: Date.now() - startedAt,
    });

    return response;
  };
}
