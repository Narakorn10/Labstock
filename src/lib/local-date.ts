/** Earliest year the analysis accepts; a date input sends years like 0002 while the user is still typing. */
export const MIN_ANALYSIS_YEAR = 2000;

/** True for a complete YYYY-MM-DD that is a real day and not before MIN_ANALYSIS_YEAR. */
export function isReasonableIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number(value.slice(0, 4)) < MIN_ANALYSIS_YEAR) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function toLocalIsoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface DateInputResult {
  commit?: { start: string; end: string };
}

/**
 * Decide what a typed date means. `other` is the opposite bound (end for the start input, start for the end input).
 * A half typed value commits nothing; a complete one is clamped to today (end only) and kept start <= end.
 */
export function resolveDateInput(draft: string, other: string, side: "start" | "end", today: string): DateInputResult {
  if (!isReasonableIsoDate(draft)) return {};
  if (side === "start") {
    return { commit: { start: draft > other ? other : draft, end: other } };
  }
  const clamped = draft > today ? today : draft;
  return { commit: { start: other, end: clamped < other ? other : clamped } };
}
