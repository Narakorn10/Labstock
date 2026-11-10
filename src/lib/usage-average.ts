// Average usage per day over the days where the real usage is fully known.
//
// Real usage = dispensed to the bench + the refill of the count work orders. A refill is spread over the days BEFORE
// its count, so for one item the refill is known only up to the day before its latest count. The days from that count
// on have the dispensed part only, which would pull an average over the whole range down. The average is therefore
// taken over the days up to the day before the latest count, using the usage of those days only.
// An item that was never counted has no refill at all, so its whole range counts.

export type KnownWindow = { startDate: string; endDate: string; days: number };

const DAY_MS = 86_400_000;
const utcDay = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dayBefore = (date: string) => new Date(utcDay(date) - DAY_MS).toISOString().slice(0, 10);
const daysBetweenInclusive = (from: string, to: string) => Math.floor((utcDay(to) - utcDay(from)) / DAY_MS) + 1;

/**
 * The days (YYYY-MM-DD, Thai calendar days) of [startDate, endDate] whose real usage is fully known for an item whose
 * latest count was on lastCountDate. Null when there is no such day.
 */
export function knownUsageWindow(startDate: string, endDate: string, lastCountDate: string | null | undefined): KnownWindow | null {
  if (startDate > endDate) return null;
  const knownUntil = lastCountDate ? dayBefore(lastCountDate) : endDate;
  const windowEnd = knownUntil < endDate ? knownUntil : endDate;
  if (windowEnd < startDate) return null;
  return { startDate, endDate: windowEnd, days: daysBetweenInclusive(startDate, windowEnd) };
}
