import sql from "./db";
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
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = await response.clone().json() as { error?: unknown; message?: unknown };
    const text = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : null;
    return text ? text.slice(0, MAX_MESSAGE) : null;
  } catch {
    return null;
  }
}

/**
 * Wraps a route handler and records one app_events row per request. The handler's
 * response is returned unchanged. The handler fills `ctx.user` once it knows who the
 * caller is (so there is no second session lookup) and `ctx.details` with the raw input.
 */
export function trackRoute<C = unknown>(
  meta: { action: string },
  handler: (request: Request, ctx: TrackContext, routeContext: C) => Promise<Response>,
) {
  return async (request: Request, routeContext?: C): Promise<Response> => {
    const startedAt = Date.now();
    const ctx: TrackContext = {};
    let response: Response | undefined;
    let thrown: unknown;
    try {
      response = await handler(request, ctx, routeContext as C);
    } catch (error) {
      thrown = error;
    }

    const status = response ? response.status : 500;
    await recordAppEvent({
      requestId: getRequestId(request),
      username: ctx.user?.username,
      role: ctx.user?.role,
      action: meta.action,
      route: new URL(request.url).pathname,
      method: request.method,
      status,
      message: response
        ? (status >= 400 ? await readErrorMessage(response) : null)
        : (thrown instanceof Error ? thrown.message : String(thrown)),
      details: ctx.details,
      durationMs: Date.now() - startedAt,
    });

    if (thrown !== undefined) throw thrown;
    return response as Response;
  };
}
