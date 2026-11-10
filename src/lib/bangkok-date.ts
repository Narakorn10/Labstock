const BANGKOK_TIME_ZONE = "Asia/Bangkok";

/** Today's calendar day in Thailand as YYYY-MM-DD, whatever timezone the server runs in. */
export function bangkokToday(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** An end date later than today (Thai time) becomes today. YYYY-MM-DD strings compare correctly as text. */
export function clampToToday(endDate: string, now: Date = new Date()) {
  const today = bangkokToday(now);
  return endDate > today ? today : endDate;
}
