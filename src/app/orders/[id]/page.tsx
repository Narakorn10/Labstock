"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";

interface PurchaseOrderDetailItem {
  id: number;
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  received_qty: number;
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

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("labstock_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchTracking = useCallback(async (trackingNo: string, provider: string) => {
    try {
      const res = await fetch(`/api/tracking/${trackingNo}?provider=${provider || "THAIPOST"}`);
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
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => router.push("/orders")} className="text-indigo-600 mb-4">
        ← กลับไปหน้ารายการ
      </button>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-2">{po.po_number}</h1>
            <p className="text-gray-600">
              บริษัท: <span className="font-medium text-black">{po.vendor}</span>
            </p>
            <p className="text-gray-600">
              วันที่คาดว่าจะส่ง: {po.expected_date ? new Date(po.expected_date).toLocaleDateString("th-TH") : "-"}
            </p>
          </div>
          <div>
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
          </div>
        </div>

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

        <h3 className="font-bold text-lg mb-4">รายการน้ำยา</h3>
        <table className="min-w-full divide-y divide-gray-200 mb-6 border">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">รหัสน้ำยา</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">ชื่อน้ำยา</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">จำนวนที่สั่ง</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">คงเหลือปัจจุบัน</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">เหตุผลที่สั่ง</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">จำนวนที่รับแล้ว</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {po.items?.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2 text-sm">{item.item_id}</td>
                <td className="px-4 py-2 text-sm">{item.item_name}</td>
                <td className="px-4 py-2 text-sm text-right">
                  {item.quantity} {item.unit}
                </td>
                <td className="px-4 py-2 text-sm text-right font-semibold text-slate-800">
                  {Number(item.current_stock_qty ?? 0)} {item.unit}
                </td>
                <td className="px-4 py-2 text-sm text-slate-700">
                  <p>ระบบแนะนำ {Number(item.system_suggested_qty ?? 0)} {item.unit} ({item.calculation_snapshot?.calculation_breakdown?.demandSource === "actual_dispense_history" ? "อ้างอิงยอดเบิกจริง" : "อ้างอิงนโยบายแล็บ"})</p>
                  {item.override_reason && <p className="mt-1 text-amber-800">แก้ไขจำนวน: {item.override_reason}</p>}
                  {!!item.calculation_snapshot?.review_reasons?.length && <p className="mt-1 text-amber-800">ข้อควรทบทวน: {item.calculation_snapshot.review_reasons.map((reason) => reviewReasonLabels[reason] ?? reason).join(", ")}</p>}
                </td>
                <td className="px-4 py-2 text-sm text-right font-medium text-green-600">
                  {item.received_qty} {item.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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
      </div>

      {tracking && (
        <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-indigo-500">
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
    </div>
  );
}
