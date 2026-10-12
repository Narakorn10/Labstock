import sql from "./db";

/**
 * PIN attempt limiter shared by /api/mobile/confirm and /api/mobile/line-link (same counter),
 * stored in app_events (no new table).
 * An attempt row is written BEFORE counting, so parallel requests cannot all see an
 * under-limit count. A correct PIN flips its row to 'success' (not counted afterwards).
 * Helpers never throw and return null on error; /api/mobile/confirm then fails open,
 * /api/mobile/line-link fails closed (503).
 */

export const PIN_ATTEMPT_ACTION = "mobile.pin_attempt";
export const PIN_ATTEMPT_LIMIT = 5;
export const PIN_ATTEMPT_WINDOW_MINUTES = 15;

const MAX_USERNAME = 100;

let warnedPinAttempts = false;

function warnOnce(error: unknown) {
  if (warnedPinAttempts) return;
  warnedPinAttempts = true;
  const text = error instanceof Error ? error.message : String(error);
  console.warn("[pin-attempts] PIN attempt tracking is unavailable (confirm fails open, line-link fails closed):", text);
}

export async function recordPinAttempt(username: string, source: "confirm" | "line-link" = "confirm"): Promise<number | null> {
  try {
    const rows = await sql`
      INSERT INTO app_events (action, route, method, outcome, status, details)
      VALUES (
        ${PIN_ATTEMPT_ACTION}, '/api/mobile/confirm', 'POST', 'rejected', 401,
        ${JSON.stringify({ attemptedUser: username.slice(0, MAX_USERNAME), source })}::jsonb
      )
      RETURNING id
    `;
    const id = Number(rows[0]?.id);
    return Number.isFinite(id) ? id : null;
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

export async function countRecentPinAttempts(username: string): Promise<number | null> {
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS n
      FROM app_events
      WHERE action = 'mobile.pin_attempt'
        AND outcome <> 'success'
        AND created_at > NOW() - INTERVAL '15 minutes'
        AND LOWER(details->>'attemptedUser') = LOWER(${username.slice(0, MAX_USERNAME)})
    `;
    return Number(rows[0]?.n ?? 0);
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

export async function markPinAttemptSuccess(id: number | null): Promise<void> {
  if (id === null) return;
  try {
    await sql`UPDATE app_events SET outcome = 'success', status = 200 WHERE id = ${id}`;
  } catch (error) {
    warnOnce(error);
  }
}
