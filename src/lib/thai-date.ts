/** dd/mm/yyyy in the Thai Buddhist calendar; returns "-" for blanks and the raw text when it is not a date. */
export function formatThaiDate(value?: string) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
