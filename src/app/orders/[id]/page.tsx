"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { exportPurchaseOrderCsv, printPurchaseOrderPdf } from "@/lib/purchase-order-export";

interface PurchaseOrderDetailItem {
  id: number;
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  received_qty: number;
  reagent_type?: string | null;
  job_type?: string | null;
  machine_type?: string | null;
  current_stock_qty?: number;
  system_suggested_qty?: number | null;
  override_reason?: string | null;
  selected_basis?: "POLICY" | "DYNAMIC" | "MANUAL" | null;
  calculation_snapshot?: {
    review_reasons?: string[];
    calculation_breakdown?: { demandSource?: string };
  } | null;
}

interface PurchaseOrderDetail {
  id: number;
  po_number: string;
  vendor: string;
  status: string;
  expected_date?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  note?: string | null;
  issuer_name?: string | null;
  issuer_department?: string | null;
  issuer_address?: string | null;
  issuer_phone?: string | null;
  issuer_email?: string | null;
  vendor_note?: string | null;
  items?: PurchaseOrderDetailItem[];
}

interface ShipmentRecord {
  po_number: string | null;
  tracking_no: string | null;
  tracking_provider: string | null;
}

interface TrackingHistoryEvent {
  timestamp: string;
  status: string;
  location: string;
  description?: string;
}

interface TrackingDetails {
  provider: string;
  trackingNo: string;
  statusText: string;
  history?: TrackingHistoryEvent[];
}

const reviewReasonLabels: Record<string, string> = {
  FUTURE_DISPENSE_LOGS_EXCLUDED: "ตัดรายการเบิกวันที่ในอนาคตออกจากการคำนวณ",
  OPEN_PURCHASE_ORDER_WITHOUT_ETA: "มี PO ค้างที่ยังไม่ระบุวันส่ง",
  STOCKOUT_BEFORE_LEAD_TIME: "สต็อกอาจหมดก่อนของมาถึง",
  POLICY_SOURCE_NEEDS_REVIEW: "นโยบายรายการนี้ยังต้องทบทวน",
  MISSING_APPROVED_CYCLE_QTY: "ยังไม่มีจำนวนสั่งที่อนุมัติต่อรอบ",
  POLICY_DYNAMIC_VARIANCE: "จำนวนจากการใช้จริงต่างจากนโยบาย",
};

export default function PODetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const router = useRouter();
  const { user } = useAuth();
  const canManageLabOrders = user?.role === "Admin" || user?.role === "Manager";
  const id = useMemo(() => {
    const value = params.id;
    return Array.isArray(value) ? value[0] : value;
  }, [params.id]);
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [tracking, setTracking] = useState<TrackingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const showInternalColumns = user?.role !== "Vendor";

  const groupedItems = useMemo(() => {
    const groups = new Map<string, PurchaseOrderDetailItem[]>();
    for (const item of po?.items ?? []) {
      const category = item.reagent_type?.trim() || "ไม่ระบุหมวดหมู่";
      groups.set(category, [...(groups.get(category) ?? []), item]);
    }

    return [...groups.entries()].sort(([left], [right]) => {
      if (left === "ไม่ระบุหมวดหมู่") return 1;
      if (right === "ไม่ระบุหมวดหมู่") return -1;
      return left.localeCompare(right, "th");
    });
  }, [po?.items]);

  const quantitySummary = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of po?.items ?? []) {
      const unit = item.unit || "หน่วย";
      totals.set(unit, (totals.get(unit) ?? 0) + Number(item.quantity || 0));
    }
    return [...totals.entries()].map(([unit, quantity]) => `${quantity} ${unit}`).join(" · ") || "-";
  }, [po?.items]);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("labstock_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchTracking = useCallback(async (trackingNo: string, provider: string) => {
    try {
      const token = localStorage.getItem("labstock_token");
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await fetch(`/api/tracking/${trackingNo}?provider=${provider || "THAIPOST"}`, { headers });
      if (res.ok) {
        setTracking((await res.json()) as TrackingDetails);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadPurchaseOrder = async () => {
      if (!id) {
        if (active) {
          setLoading(false);
        }
        return;
      }

      try {
        const headers = getAuthHeaders();
        const res = await fetch(`/api/purchase-orders/${id}`, { headers });
        if (res.ok) {
          const data = (await res.json()) as PurchaseOrderDetail;
          if (active) {
            setPo(data);
          }

          const shipRes = await fetch("/api/vendor/shipments", { headers });
          if (shipRes.ok) {
            const shipments = (await shipRes.json()) as ShipmentRecord[];
            const poShipment = shipments.find((shipment) => shipment.po_number === data.po_number && shipment.tracking_no);
            if (poShipment?.tracking_no) {
              await fetchTracking(poShipment.tracking_no, poShipment.tracking_provider ?? "THAIPOST");
            }
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadPurchaseOrder();

    return () => {
      active = false;
    };
  }, [fetchTracking, id]);

  const reviewManagerOrder = async (action: "APPROVE_MANAGER_REVIEW" | "REJECT_MANAGER_REVIEW") => {
    if (!po) return;
    if (action === "REJECT_MANAGER_REVIEW" && !reviewNote.trim()) {
      alert("โปรดระบุเหตุผลเมื่อไม่อนุมัติใบ PO");
      return;
    }
    if (!confirm(action === "APPROVE_MANAGER_REVIEW" ? "ยืนยันส่งใบ PO นี้ให้บริษัทหรือไม่?" : "ยืนยันไม่อนุมัติใบ PO นี้หรือไม่?")) return;
    setReviewSubmitting(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ action, note: reviewNote.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        alert(data?.error ?? "ไม่สามารถบันทึกการตรวจสอบได้");
        return;
      }
      setPo(data as PurchaseOrderDetail);
      setReviewNote("");
    } finally {
      setReviewSubmitting(false);
    }
  };

  if (loading) return <div className="p-6">กำลังโหลดใบสั่งน้ำยา...</div>;
  if (!po) return <div className="p-6">ไม่พบใบสั่งน้ำยานี้ หรือคุณไม่มีสิทธิ์ดูรายการ</div>;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <button onClick={() => router.push("/orders")} className="no-print mb-4 text-indigo-600">
        ← กลับไปหน้ารายการ
      </button>

      <article className="po-document mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <header className="mb-8 border-b-4 border-slate-900 pb-6">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Official procurement document</p>
              <h1 className="mt-2 text-3xl font-black text-slate-950">ใบสั่งซื้อน้ำยา</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">Purchase Order</p>
              <p className="mt-4 font-bold text-slate-900">{po.issuer_name || "LabStock"}</p>
              {po.issuer_department && <p className="text-sm text-slate-600">{po.issuer_department}</p>}
              {po.issuer_address && <p className="mt-1 max-w-xl whitespace-pre-line text-xs text-slate-500">{po.issuer_address}</p>}
              {(po.issuer_phone || po.issuer_email) && <p className="mt-1 text-xs text-slate-500">{[po.issuer_phone, po.issuer_email].filter(Boolean).join(" · ")}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">PO Number</p>
              <p className="mt-1 font-mono text-xl font-black text-slate-900">{po.po_number}</p>
            </div>
          </div>
        </header>

        <div className="mb-8 grid gap-4 border-b border-slate-200 pb-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-bold text-slate-400">บริษัท / Vendor</p>
            <p className="mt-1 font-semibold text-slate-900">{po.vendor}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400">วันที่ออกเอกสาร</p>
            <p className="mt-1 font-semibold text-slate-900">{po.created_at ? new Date(po.created_at).toLocaleDateString("th-TH") : "-"}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400">วันที่คาดว่าจะส่ง</p>
            <p className="mt-1 font-semibold text-slate-900">{po.expected_date ? new Date(po.expected_date).toLocaleDateString("th-TH") : "-"}</p>
          </div>
          <div className="sm:text-right lg:text-left">
            <span
              className={`px-3 py-1 text-sm rounded-full font-bold ${
                po.status === "SUBMITTED"
                  ? "bg-yellow-100 text-yellow-800"
                  : po.status === "CONFIRMED"
                    ? "bg-blue-100 text-blue-800"
                    : po.status === "SHIPPED"
                      ? "bg-purple-100 text-purple-800"
                      : po.status === "RECEIVED"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
              }`}
            >
              {po.status}
            </span>
            <div className="no-print mt-3 flex flex-wrap gap-2 sm:justify-end lg:justify-start">
              <button
                type="button"
                onClick={() => exportPurchaseOrderCsv(po, { includeLabNote: showInternalColumns })}
                className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                ดาวน์โหลด Excel (CSV)
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    printPurchaseOrderPdf(po, { includeLabNote: showInternalColumns });
                  } catch (error) {
                    alert(error instanceof Error ? error.message : "ไม่สามารถเปิดหน้าพิมพ์ได้");
                  }
                }}
                className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
              >
                บันทึก PDF
              </button>
            </div>
          </div>
        </div>

        {showInternalColumns && po.note && (
          <div className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <h3 className="mb-1 font-bold text-indigo-900">หมายเหตุภายใน Lab</h3>
            <p className="whitespace-pre-line text-sm text-indigo-800">{po.note}</p>
          </div>
        )}

        {po.vendor_note && (
          <div className="bg-yellow-50 p-4 rounded-lg mb-6 border border-yellow-200">
            <h3 className="font-bold text-yellow-800 mb-1">หมายเหตุจากบริษัท</h3>
            <p className="text-sm text-yellow-700">{po.vendor_note}</p>
          </div>
        )}

        {po.status === "PENDING_MANAGER_REVIEW" && canManageLabOrders && (
          <section className="mb-6 rounded-xl border border-teal-200 bg-teal-50 p-5">
            <h2 className="text-lg font-bold text-teal-950">ตรวจสอบก่อนส่งให้บริษัท</h2>
            <p className="mt-1 text-sm text-teal-900">ระบบจะส่ง PO ให้บริษัทหลังหัวหน้ายืนยันเท่านั้น กรุณาตรวจสอบปริมาณคงเหลือและเหตุผลของแต่ละรายการ</p>
          </section>
        )}

        <section className="mb-6" aria-labelledby="po-items-title">
          <div className="mb-5 flex flex-col gap-2 border-b-2 border-slate-900 pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-600">Ordered items</p>
              <h3 id="po-items-title" className="mt-1 text-xl font-bold text-slate-950">รายการน้ำยาแยกตามหมวดหมู่</h3>
            </div>
            <p className="text-xs font-semibold text-slate-500">รวม {po.items?.length ?? 0} รายการ · {quantitySummary}</p>
          </div>

          <div className="space-y-6">
            {groupedItems.map(([category, categoryItems]) => (
              <section key={category} className="po-category break-inside-avoid rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <h4 className="font-bold text-slate-900">{category}</h4>
                  <span className="text-xs font-semibold text-slate-500">{categoryItems.length} รายการ</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[920px] w-full text-sm">
                    <thead className="bg-white text-xs text-slate-500">
                      <tr className="border-b border-slate-200">
                        <th className="px-4 py-3 text-left">#</th>
                        <th className="px-4 py-3 text-left">รหัส / ชื่อน้ำยา</th>
                        <th className="px-4 py-3 text-left">งานตรวจ</th>
                        <th className="px-4 py-3 text-left">เครื่องตรวจ</th>
                        <th className="px-4 py-3 text-right">จำนวนสั่ง</th>
                        {showInternalColumns && <th className="px-4 py-3 text-right">คงเหลือ</th>}
                        {showInternalColumns && <th className="px-4 py-3 text-left">เหตุผลที่สั่ง</th>}
                        <th className="px-4 py-3 text-right">รับแล้ว</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {categoryItems.map((item, index) => (
                        <tr key={item.id}>
                          <td className="px-4 py-3 text-slate-400">{index + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">{item.item_name}</p>
                            <p className="mt-1 font-mono text-xs text-slate-500">{item.item_id}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{item.job_type || "-"}</td>
                          <td className="px-4 py-3 text-slate-600">{item.machine_type || "-"}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900">{item.quantity} {item.unit}</td>
                          {showInternalColumns && (
                            <td className="px-4 py-3 text-right font-semibold text-slate-700">
                              {Number(item.current_stock_qty ?? 0)} {item.unit}
                            </td>
                          )}
                          {showInternalColumns && (
                            <td className="max-w-xs px-4 py-3 text-xs leading-5 text-slate-600">
                              <p>ระบบแนะนำ {Number(item.system_suggested_qty ?? 0)} {item.unit} ({item.calculation_snapshot?.calculation_breakdown?.demandSource === "actual_dispense_history" ? "อ้างอิงยอดเบิกจริง" : "อ้างอิงนโยบายแล็บ"})</p>
                              {item.override_reason && <p className="mt-1 text-amber-800">แก้ไขจำนวน: {item.override_reason}</p>}
                              {!!item.calculation_snapshot?.review_reasons?.length && <p className="mt-1 text-amber-800">ข้อควรทบทวน: {item.calculation_snapshot.review_reasons.map((reason) => reviewReasonLabels[reason] ?? reason).join(", ")}</p>}
                            </td>
                          )}
                          <td className="px-4 py-3 text-right font-semibold text-emerald-700">{item.received_qty} {item.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-8 border-t border-slate-200 pt-8 sm:grid-cols-3">
          {[
            ["ผู้จัดทำ", po.created_by || "ลงชื่อ / วันที่"],
            ["ผู้ตรวจสอบ", "ลงชื่อ / วันที่"],
            ["ผู้อนุมัติ", "ลงชื่อ / วันที่"],
          ].map(([label, detail]) => (
            <div key={label} className="text-center">
              <div className="h-12 border-b border-slate-400" />
              <p className="mt-2 text-sm font-bold text-slate-700">{label}</p>
              <p className="mt-1 text-xs text-slate-400">{detail}</p>
            </div>
          ))}
        </section>

        {po.status === "PENDING_MANAGER_REVIEW" && canManageLabOrders && (
          <div className="border-t pt-5">
            <label className="block text-sm font-medium text-slate-700" htmlFor="manager-review-note">หมายเหตุหัวหน้า (ต้องระบุเมื่อไม่อนุมัติ)</label>
            <textarea id="manager-review-note" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 p-3" rows={3} maxLength={500} />
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" disabled={reviewSubmitting} onClick={() => void reviewManagerOrder("APPROVE_MANAGER_REVIEW")} className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-60">ยืนยันและส่งให้บริษัท</button>
              <button type="button" disabled={reviewSubmitting} onClick={() => void reviewManagerOrder("REJECT_MANAGER_REVIEW")} className="rounded-lg border border-red-300 px-4 py-2 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">ไม่อนุมัติ</button>
            </div>
          </div>
        )}
      </article>

      {tracking && (
        <div className="no-print bg-white rounded-lg shadow-sm p-6 border-l-4 border-indigo-500">
          <h2 className="text-xl font-bold mb-4">🚚 การจัดส่ง (Tracking)</h2>
          <div className="flex gap-4 mb-6">
            <div className="flex-1 bg-gray-50 p-4 rounded">
              <p className="text-sm text-gray-500">Provider</p>
              <p className="font-bold">{tracking.provider}</p>
            </div>
            <div className="flex-1 bg-gray-50 p-4 rounded">
              <p className="text-sm text-gray-500">Tracking No</p>
              <p className="font-bold">{tracking.trackingNo}</p>
            </div>
            <div className="flex-1 bg-gray-50 p-4 rounded">
              <p className="text-sm text-gray-500">Status</p>
              <p className="font-bold text-indigo-600">{tracking.statusText}</p>
            </div>
          </div>

          <div className="relative border-l-2 border-indigo-200 ml-4 pl-6 space-y-6">
            {tracking.history?.map((event, i) => (
              <div key={i} className="relative">
                <div className="absolute w-4 h-4 bg-indigo-500 rounded-full -left-[31px] top-1 border-4 border-white"></div>
                <p className="text-sm text-gray-500 mb-1">{new Date(event.timestamp).toLocaleString()}</p>
                <p className="font-bold">{event.status}</p>
                <p className="text-sm text-gray-600">{event.location}</p>
                {event.description && <p className="text-xs text-gray-400 mt-1">{event.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .po-document { border: 0 !important; box-shadow: none !important; padding: 0 !important; }
          .po-category, tr { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
