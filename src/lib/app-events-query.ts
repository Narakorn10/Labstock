import sql from "./db";
import type { AppEventOutcomeFilter, AppEventRow, RepeatedFailure } from "./app-events-types";

export const APP_EVENT_RETENTION_DAYS = 90;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OUTCOMES = new Set(["success", "rejected", "error", "failed"]);

export interface AppEventFilters {
  username?: string;
  action?: string;
  outcome?: string;
  startDate?: string;
  endDate?: string;
  before?: number;
  limit?: number;
}

const clean = (value: string | undefined) => {
  const text = value?.trim();
  return text ? text : null;
};

/** Returns one page of events, newest first, plus the cursor for the next page (or null). */
export async function listAppEvents(filters: AppEventFilters) {
  const limit = Math.min(Math.max(Math.trunc(filters.limit || DEFAULT_LIMIT), 1), MAX_LIMIT);
  const username = clean(filters.username);
  const action = clean(filters.action);
  const outcome = filters.outcome && OUTCOMES.has(filters.outcome) ? (filters.outcome as AppEventOutcomeFilter) : null;
  const startDate = filters.startDate && DATE_PATTERN.test(filters.startDate) ? filters.startDate : null;
  const endDate = filters.endDate && DATE_PATTERN.test(filters.endDate) ? filters.endDate : null;
  const before = Number.isInteger(filters.before) && (filters.before as number) > 0 ? (filters.before as number) : null;

  // Dates are calendar days in Thai time, so a day covers 00:00 to 24:00 Asia/Bangkok.
  const rows = await sql`
    SELECT id, created_at AS "createdAt", request_id AS "requestId", username, role, action, route, method,
           outcome, status, message, details, duration_ms AS "durationMs"
    FROM app_events
    WHERE (${username}::text IS NULL OR LOWER(username) = LOWER(${username}::text))
      AND (${action}::text IS NULL OR action = ${action}::text)
      AND (${outcome}::text IS NULL OR outcome = ${outcome}::text OR (${outcome}::text = 'failed' AND outcome <> 'success'))
      AND (${startDate}::date IS NULL OR created_at >= (${startDate}::date)::timestamp AT TIME ZONE 'Asia/Bangkok')
      AND (${endDate}::date IS NULL OR created_at < ((${endDate}::date + 1))::timestamp AT TIME ZONE 'Asia/Bangkok')
      AND (${before}::bigint IS NULL OR id < ${before}::bigint)
    ORDER BY id DESC
    LIMIT ${limit + 1}
  ` as unknown as Array<Omit<AppEventRow, "id"> & { id: string | number }>;

  const page = rows.slice(0, limit).map((row) => ({ ...row, id: Number(row.id) })) as AppEventRow[];
  return { items: page, nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

/** Failures seen at least twice in the last 7 days, most widespread first (many users = likely a real bug). */
export async function getRepeatedFailures(): Promise<RepeatedFailure[]> {
  const rows = await sql`
    SELECT action, message, COUNT(*)::int AS occurrences, COUNT(DISTINCT LOWER(username))::int AS users, MAX(created_at) AS "lastSeen"
    FROM app_events
    WHERE outcome <> 'success' AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY action, message
    HAVING COUNT(*) >= 2
    ORDER BY users DESC, occurrences DESC, MAX(created_at) DESC
    LIMIT 10
  `;
  return rows as unknown as RepeatedFailure[];
}

/** Deletes events older than the retention window. Returns how many rows were removed. */
export async function purgeOldAppEvents(): Promise<number> {
  const rows = await sql`
    WITH removed AS (
      DELETE FROM app_events WHERE created_at < NOW() - ${APP_EVENT_RETENTION_DAYS} * INTERVAL '1 day' RETURNING 1
    )
    SELECT COUNT(*)::int AS n FROM removed
  `;
  return Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
}
