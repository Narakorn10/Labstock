export type ShipmentDraft = {
  itemId: string;
  lotNo: string;
  expDate: string;
  qty: number;
  confidence?: "green" | "amber" | "red";
  mappingReason?: string;
};

export type OrderCandidate = {
  itemId: string;
  itemName: string;
  orderedQty: number;
  remainingQty: number;
  aliases?: string[];
};

export function normalizeShipmentText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, " ").trim();
}

function scoreName(source: string, candidate: string) {
  const sourceWords = new Set(normalizeShipmentText(source).split(" ").filter(Boolean));
  const candidateWords = new Set(normalizeShipmentText(candidate).split(" ").filter(Boolean));
  if (!sourceWords.size || !candidateWords.size) return 0;
  let overlap = 0;
  sourceWords.forEach((word) => {
    if (candidateWords.has(word)) overlap += 1;
  });
  return overlap / Math.max(sourceWords.size, candidateWords.size);
}

function findValue(lines: string[], pattern: RegExp) {
  const hit = lines.map((line) => line.match(pattern)).find(Boolean);
  return hit?.[1]?.trim() ?? "";
}

function normalizeOcrDate(value: string) {
  const parts = value.replace(/[./]/g, "-").split("-");
  if (parts.length !== 3) return value;
  if (parts[0].length === 4) return parts.map((part) => part.padStart(2, "0")).join("-");
  if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  return value;
}

export function mapOcrText(text: string, candidates: OrderCandidate[]): ShipmentDraft[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lotNo = findValue(lines, /(?:lot|batch)\s*(?:no\.?|number)?\s*[:#-]?\s*([a-z0-9-]+)/i);
  const expDate = findValue(lines, /(?:exp(?:iry|iration)?|use\s*by)\s*(?:date)?\s*[:#-]?\s*(\d{1,4}[./-]\d{1,2}[./-]\d{1,4})/i);
  const qtyText = findValue(lines, /(?:qty|quantity)\s*[:#-]?\s*(\d+(?:\.\d+)?)/i);
  const qty = Number(qtyText);

  return lines.flatMap((line) => {
    const normalizedLine = normalizeShipmentText(line);
    const exact = candidates.find((candidate) =>
      normalizedLine.includes(normalizeShipmentText(candidate.itemId)) ||
      normalizedLine.includes(normalizeShipmentText(candidate.itemName)) ||
      candidate.aliases?.some((alias) => normalizedLine.includes(normalizeShipmentText(alias))),
    );
    const fuzzy = exact ? undefined : candidates
      .map((candidate) => ({ candidate, score: scoreName(line, candidate.itemName) }))
      .sort((a, b) => b.score - a.score)[0];
    const matched = exact ?? (fuzzy && fuzzy.score >= 0.72 ? fuzzy.candidate : undefined);
    if (!matched) return [];

    const lineQty = Number(findValue([line], /(?:qty|quantity)?\s*(\d+(?:\.\d+)?)/i)) || qty || 0;
    const lineLot = findValue([line], /(?:lot|batch)\s*(?:no\.?)?\s*[:#-]?\s*([a-z0-9-]+)/i) || lotNo;
    const lineExp = findValue([line], /(?:exp(?:iry|iration)?|use\s*by)\s*[:#-]?\s*(\d{1,4}[./-]\d{1,2}[./-]\d{1,4})/i) || expDate;
    return [{
      itemId: matched.itemId,
      lotNo: lineLot,
      expDate: normalizeOcrDate(lineExp),
      qty: lineQty,
      confidence: exact && lineLot && lineExp && lineQty > 0 ? "green" : matched ? "amber" : "red",
      mappingReason: exact ? "Matched to the selected order" : "Conservative name match; verify before submitting",
    }];
  });
}
