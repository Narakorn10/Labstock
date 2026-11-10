// The log row of a stock adjustment has no column for the old quantity or the reason, so they are written after the
// fixed action text:
//   "ปรับปรุง lot/exp/qty (Reconciliation) | ยอด 10 → 8 | Lot A → B | EXP 2027-01-01 → 2027-02-01 | เหตุผล: นับจริง"
// This file is pure (no database) so the API route and the Audit Center page share one definition of the text.

export const ADJUSTMENT_ACTION_PREFIX = "ปรับปรุง lot/exp/qty (Reconciliation)";
/** Value of the Audit Center "ปรับยอด" filter: every action the system has written for an adjustment (they all start with this) */
export const ADJUST_FILTER = "__ADJUST__";
export const ADJUSTMENT_ACTION_LIKE = "ปรับปรุง%";

const SEPARATOR = " | ";
const REASON_MARKER = `${SEPARATOR}เหตุผล: `;
const MAX_REASON_LENGTH = 120;
const MAX_FIELD_LENGTH = 60;

/** The three texts written so far: ปรับปรุงยอดสต๊อก (Reconciliation), ปรับปรุง lot/exp/qty (Reconciliation), ปรับปรุงยอด (Adjustment) */
export function isAdjustmentAction(action: string): boolean {
  return typeof action === "string" && action.startsWith("ปรับปรุง");
}

// Line breaks and control characters become a space; the separator, and the characters that break Telegram (HTML) and
// CSV export, are replaced or removed (every | becomes /) so one user-typed value cannot forge another part of the text.
function clean(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\|/g, "/")
    .replace(/[<>&"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** Reason typed by the user: cleaned and cut to 120 characters; empty string when there is nothing to keep. */
export function sanitizeReason(value: unknown): string {
  return clean(value, MAX_REASON_LENGTH);
}

const textOf = (value: string | null | undefined) => clean(value ?? "", MAX_FIELD_LENGTH);
const rawOf = (value: string | null | undefined) => (typeof value === "string" ? value.trim() : "");

export type AdjustmentInput = {
  oldQty: number;
  newQty: number;
  oldLot?: string | null;
  newLot?: string | null;
  oldExp?: string | null;
  newExp?: string | null;
  reason?: string | null;
};

export function buildAdjustmentAction(input: AdjustmentInput): string {
  const parts = [ADJUSTMENT_ACTION_PREFIX, `ยอด ${input.oldQty} → ${input.newQty}`];
  // Whether a lot / expiry changed is decided on the stored values, not on the cleaned text that is written, so a change
  // that the cleaning would hide (A|B -> A/B, or a difference after the 60th character) is still recorded.
  if (rawOf(input.oldLot) !== rawOf(input.newLot)) parts.push(`Lot ${textOf(input.oldLot) || "-"} → ${textOf(input.newLot) || "-"}`);
  if (rawOf(input.oldExp) !== rawOf(input.newExp)) parts.push(`EXP ${textOf(input.oldExp) || "-"} → ${textOf(input.newExp) || "-"}`);
  let text = parts.join(SEPARATOR);
  const reason = sanitizeReason(input.reason);
  if (reason) text += `${REASON_MARKER}${reason}`;
  return text;
}

export type ParsedAdjustment = {
  oldQty: number | null;
  newQty: number | null;
  /** "Lot A → B" / "EXP x → y" parts, as written */
  changes: string[];
  reason: string | null;
};

/** Null when the action is not an adjustment. Old texts without details give nulls and no changes. */
export function parseAdjustmentAction(action: string): ParsedAdjustment | null {
  if (!isAdjustmentAction(action)) return null;
  const result: ParsedAdjustment = { oldQty: null, newQty: null, changes: [], reason: null };
  if (!action.startsWith(ADJUSTMENT_ACTION_PREFIX)) return result;

  let rest = action.slice(ADJUSTMENT_ACTION_PREFIX.length);
  const reasonAt = rest.indexOf(REASON_MARKER);
  if (reasonAt >= 0) {
    result.reason = rest.slice(reasonAt + REASON_MARKER.length) || null;
    rest = rest.slice(0, reasonAt);
  }
  const parts = rest.split(SEPARATOR).slice(1); // the first piece is what stands before the first separator

  // Only the part right after the fixed text can be the quantity part.
  const quantity = parts[0]?.match(/^ยอด (-?\d+(?:\.\d+)?) → (-?\d+(?:\.\d+)?)$/);
  if (quantity) {
    result.oldQty = Number(quantity[1]);
    result.newQty = Number(quantity[2]);
  }
  for (const part of parts.slice(quantity ? 1 : 0)) {
    if (part.startsWith("Lot ") || part.startsWith("EXP ")) result.changes.push(part);
  }
  return result;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * What the Audit Center shows for an adjustment row. A row with details shows the change (+2 / -2 / 0) and old -> new.
 * An old Reconciliation row only knows the new quantity. The "(Adjustment)" rows are not known to hold a new quantity,
 * so they show just the number.
 */
export function describeAdjustment(action: string, loggedQty: number): { deltaText: string | null; rangeText: string } {
  const parsed = parseAdjustmentAction(action);
  if (parsed && parsed.oldQty !== null && parsed.newQty !== null) {
    const delta = round2(parsed.newQty - parsed.oldQty);
    return { deltaText: delta > 0 ? `+${delta}` : String(delta), rangeText: `${parsed.oldQty} → ${parsed.newQty}` };
  }
  if (action.startsWith("ปรับปรุงยอดสต๊อก") || action.startsWith(ADJUSTMENT_ACTION_PREFIX)) {
    return { deltaText: null, rangeText: `ยอดใหม่ ${loggedQty}` };
  }
  return { deltaText: null, rangeText: String(loggedQty) };
}
