import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { SHIPMENTS_DISABLED_MESSAGE, SHIPMENTS_ENABLED } from "@/lib/feature-flags";
import { mapOcrText, type OrderCandidate } from "@/lib/shipment-ocr";

export const runtime = "nodejs";

async function getCandidates(poNumber: string, vendor: string): Promise<OrderCandidate[] | null> {
  const rows = await sql`
    SELECT p.id, poi.item_id, poi.item_name, poi.quantity,
      GREATEST(poi.quantity - COALESCE(shipped.shipped_qty, 0), 0) AS remaining_qty,
      COALESCE(array_agg(DISTINCT a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}') AS aliases
    FROM purchase_orders p
    JOIN purchase_order_items poi ON poi.po_id = p.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(s.quantity), 0) AS shipped_qty FROM shipments s
      WHERE s.po_number = p.po_number AND s.item_id = poi.item_id AND s.status <> 'Cancelled'
    ) shipped ON true
    LEFT JOIN vendor_item_aliases a ON a.vendor = p.vendor AND a.item_id = poi.item_id
    WHERE p.po_number = ${poNumber} AND p.vendor = ${vendor}
      AND p.status IN ('CONFIRMED', 'PARTIALLY_SHIPPED')
    GROUP BY p.id, poi.id, shipped.shipped_qty
  `;
  if (!rows.length) return null;
  return rows.map((row) => ({
    itemId: String(row.item_id), itemName: String(row.item_name), orderedQty: Number(row.quantity),
    remainingQty: Number(row.remaining_qty), aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
  }));
}

async function analyzeWithAzure(base64Source: string) {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.replace(/\/$/, "");
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key) throw new Error("Azure Document Intelligence is not configured");
  const payloadBytes = Buffer.byteLength(base64Source, "base64");
  if (payloadBytes > 3_500_000) throw new Error("Each OCR page must be smaller than 3.5 MB");

  const usage = await sql`SELECT COALESCE(SUM(page_count), 0) AS pages FROM shipment_ocr_usage WHERE month_start = date_trunc('month', NOW())::date`;
  if (Number(usage[0]?.pages ?? 0) >= 480) throw new Error("Automated OCR quota is reserved; use manual entry");
  const start = await fetch(`${endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30`, {
    method: "POST", headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Source }),
  });
  if (!start.ok) throw new Error("Azure OCR request failed");
  const operationLocation = start.headers.get("operation-location");
  if (!operationLocation) throw new Error("Azure OCR did not return an operation URL");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const result = await fetch(operationLocation, { headers: { "Ocp-Apim-Subscription-Key": key } });
    if (!result.ok) throw new Error("Azure OCR result request failed");
    const data = await result.json() as { status?: string; analyzeResult?: { content?: string } };
    if (data.status === "succeeded") {
      await sql`INSERT INTO shipment_ocr_usage (month_start, page_count) VALUES (date_trunc('month', NOW())::date, 1)`;
      return data.analyzeResult?.content ?? "";
    }
    if (data.status === "failed") throw new Error("Azure OCR could not read this page");
  }
  throw new Error("Azure OCR timed out; use manual entry");
}

export async function POST(request: Request) {
  if (!SHIPMENTS_ENABLED) return NextResponse.json({ error: SHIPMENTS_DISABLED_MESSAGE }, { status: 503 });
  const user = await getAuthenticatedUser(request);
  if (!user || user.role !== "Vendor" || !user.vendor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { poNumber?: string; text?: string; base64Source?: string };
    const poNumber = String(body.poNumber ?? "").trim();
    const candidates = await getCandidates(poNumber, user.vendor);
    if (!candidates) return NextResponse.json({ error: "Choose an eligible confirmed order first" }, { status: 400 });
    const text = typeof body.text === "string" ? body.text : await analyzeWithAzure(String(body.base64Source ?? ""));
    if (!text.trim()) return NextResponse.json({ error: "No usable text was found; enter the shipment manually" }, { status: 422 });
    // Raw text is intentionally used only in memory and never persisted or logged.
    return NextResponse.json({ items: mapOcrText(text, candidates), candidates });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OCR failed" }, { status: 422 });
  }
}
