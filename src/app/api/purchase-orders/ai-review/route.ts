import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getPurchaseOrderSuggestions } from "@/lib/purchase-order-suggestions";
import { isLabPurchasingRole } from "@/lib/purchase-order-workflow";
import {
  aiReviewerResponseSchema,
  buildAiReviewerPayload,
  fingerprintAiReviewerPayload,
  parseAiReviews,
} from "@/lib/purchase-order-ai-review";

export const runtime = "nodejs";
const RATE_LIMIT_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 60_000;

function vendorFingerprint(vendor: string) {
  return fingerprintAiReviewerPayload([{ item_id: vendor, item_name: "", current_stock: 0, unit: "", daily_demand: 0, policy_order_qty: 0, dynamic_order_qty: 0, projected_balance_at_horizon: 0, safety_stock: 0, lead_time_days: 0, horizon_days: 0, overdue_on_order_qty: 0, review_reasons: [], expedite_required: false, expiry: { expired_qty_excluded: 0, expiring_within_horizon_qty: 0, nearest_expiry_date: null } }]);
}

function aiUnavailable(message = "AI ใช้ไม่ได้ชั่วคราว คำแนะนำตามสูตรเดิมยังใช้งานได้") {
  return NextResponse.json({ error: message, code: "AI_UNAVAILABLE" }, { status: 503 });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isLabPurchasingRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let vendor: string;
  try {
    const body = await request.json() as { vendor?: unknown };
    vendor = typeof body.vendor === "string" ? body.vendor.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!vendor || vendor.length > 200) return NextResponse.json({ error: "A vendor filter is required" }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  if (!apiKey || !model) return aiUnavailable("ยังไม่ได้เปิดใช้ AI reviewer");

  const vendorHash = vendorFingerprint(vendor);
  let auditId: number | undefined;
  try {
    const latest = await sql`SELECT requested_at FROM purchase_order_ai_review_rate_limits WHERE actor = ${user.username} AND vendor_fingerprint = ${vendorHash} LIMIT 1`;
    const previous = latest[0]?.requested_at ? new Date(String(latest[0].requested_at)).getTime() : 0;
    if (previous && Date.now() - previous < RATE_LIMIT_MS) {
      return NextResponse.json({ error: "กรุณารอสักครู่ก่อนวิเคราะห์ซ้ำ", code: "RATE_LIMITED" }, { status: 429 });
    }
    await sql`
      INSERT INTO purchase_order_ai_review_rate_limits (actor, vendor_fingerprint, requested_at)
      VALUES (${user.username}, ${vendorHash}, NOW())
      ON CONFLICT (actor, vendor_fingerprint) DO UPDATE SET requested_at = EXCLUDED.requested_at
    `;
    const suggestions = await getPurchaseOrderSuggestions(sql, { vendor });
    const payload = buildAiReviewerPayload(suggestions);
    const fingerprint = fingerprintAiReviewerPayload(payload);
    const inserted = await sql`
      INSERT INTO purchase_order_ai_review_audit (actor, model, input_fingerprint, status)
      VALUES (${user.username}, ${model}, ${fingerprint}, 'PENDING') RETURNING id
    `;
    auditId = Number(inserted[0]?.id);
    if (!Number.isInteger(auditId)) return aiUnavailable();

    const prompt = [
      "คุณเป็นผู้ตรวจทานคำแนะนำสั่งน้ำยาของห้องปฏิบัติการ ตอบภาษาไทยเท่านั้น.",
      "คุณมีหน้าที่อธิบายความเสี่ยงและจัดระดับความเร่งด่วนจากข้อมูลที่ให้เท่านั้น.",
      "ห้ามเสนอ เปลี่ยน หรือคำนวณจำนวนสั่ง ห้ามสร้าง PO ห้ามอนุมัติแทนมนุษย์ และห้ามเพิ่มข้อมูลที่ไม่มีในข้อมูลสรุป.",
      "ส่งคืน JSON ตาม schema เท่านั้น; evidence ต้องอ้างอิงตัวเลขหรือสถานะที่ปรากฏในข้อมูล.",
      "ข้อมูลสรุปที่ผ่านการลดข้อมูลแล้ว:", JSON.stringify(payload),
    ].join("\n");
    const client = new GoogleGenAI({ apiKey });
    const response = await Promise.race([
      client.models.generateContent({ model, contents: prompt, config: { responseMimeType: "application/json", responseSchema: aiReviewerResponseSchema } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI_REVIEW_TIMEOUT")), TIMEOUT_MS)),
    ]);
    const parsed = parseAiReviews(JSON.parse(response.text || ""), new Set(payload.map((item) => item.item_id)));
    if (!parsed) throw new Error("AI_REVIEW_INVALID_OUTPUT");
    await sql`UPDATE purchase_order_ai_review_audit SET status = 'COMPLETED', result_json = ${JSON.stringify({ reviews: parsed })}::jsonb, completed_at = NOW() WHERE id = ${auditId}`;
    return NextResponse.json({ reviewer: "Gemini", model, reviews: parsed });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "unknown error";
    console.error("Purchase order AI review unavailable", errorMessage);
    if (typeof auditId === "number") {
      try { await sql`UPDATE purchase_order_ai_review_audit SET status = 'FAILED', completed_at = NOW() WHERE id = ${auditId}`; } catch { /* audit table may be unavailable */ }
    }
    return errorMessage === "AI_REVIEW_TIMEOUT"
      ? aiUnavailable("AI ใช้เวลาวิเคราะห์นานเกิน 60 วินาที กรุณาลองใหม่อีกครั้ง")
      : aiUnavailable();
  }
}
