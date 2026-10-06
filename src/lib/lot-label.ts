/**
 * QR payload printed on our own per-lot stickers: `LS1|<itemId>|<lotNo>|<expYYYY-MM-DD>`.
 * Each field is percent-encoded so a lot number may safely contain `|`.
 */
export const LOT_LABEL_PREFIX = "LS1";

export interface LotLabelData {
  itemId: string;
  lotNo: string;
  expDate: string;
}

const encodeField = (value: string) => encodeURIComponent(value.trim());

export function buildLotLabelPayload({ itemId, lotNo, expDate }: LotLabelData) {
  const exp = /^\d{4}-\d{2}-\d{2}/.test(expDate || "") ? expDate.slice(0, 10) : "";
  return [LOT_LABEL_PREFIX, encodeField(itemId), encodeField(lotNo), exp].join("|");
}

/** Returns null for anything that is not one of our lot labels. */
export function parseLotLabelPayload(raw: string): LotLabelData | null {
  const parts = (raw || "").trim().split("|");
  if (parts.length !== 4 || parts[0].toUpperCase() !== LOT_LABEL_PREFIX) return null;

  try {
    const itemId = decodeURIComponent(parts[1]).trim();
    const lotNo = decodeURIComponent(parts[2]).trim();
    const expDate = parts[3].trim();
    if (!itemId || !lotNo) return null;
    if (expDate && !/^\d{4}-\d{2}-\d{2}$/.test(expDate)) return null;
    return { itemId, lotNo, expDate };
  } catch {
    return null;
  }
}
