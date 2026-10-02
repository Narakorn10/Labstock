"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { usePopup } from "@/components/popup/popup-provider";
import { exportPurchaseOrderCsv, openPurchaseOrderPrintWindow, printPurchaseOrderPdf } from "@/lib/purchase-order-export";

type OrderItem = { item_id: string; item_name: string; quantity: number; unit: string };
type OrderLine = OrderItem & { received_qty?: number | null };
type SuggestedItem = OrderItem & { current_qty: number; min_threshold: number; suggested_order_qty: number };
type PurchaseOrder = {
  id: number;
  po_number: string;
  status: string;
  proposal_origin?: "LAB" | "VENDOR";
  note?: string;
  vendor_note?: string;
  expected_date?: string;
  created_at: string;
  items: OrderLine[];
};

const statusLabel: Record<string, string> = {
  PENDING_LAB_REVIEW: "รอ Lab ตรวจสอบ",
  SUBMITTED: "Lab ส่งรายการแล้ว",
  ACKNOWLEDGED: "Vendor รับทราบแล้ว",
  REVISION_REQUESTED: "Vendor แก้ไข รอ Lab ยืนยัน",
  CONFIRMED: "ยืนยันแล้ว",
  PARTIALLY_SHIPPED: "จัดส่งบางส่วน",
  SHIPPED: "จัดส่งแล้ว",
  PARTIALLY_RECEIVED: "รับเข้าแล้วบางส่วน",
  RECEIVED: "Lab รับเข้าแล้ว",
  REJECTED: "ปฏิเสธ",
  CANCELLED: "Lab ยกเลิกแล้ว",
  CLOSED_SHORT: "Lab ปิดใบ (ไม่รับส่วนที่เหลือ)",
};

const okTag = "bg-ok-bg text-ok";
const warnTag = "bg-warn-bg text-warn";
const critTag = "bg-crit-bg text-crit";
const statusTone: Record<string, string> = {
  CONFIRMED: okTag, SHIPPED: okTag, RECEIVED: okTag,
  PENDING_LAB_REVIEW: warnTag, SUBMITTED: warnTag, ACKNOWLEDGED: warnTag, REVISION_REQUESTED: warnTag,
  PARTIALLY_SHIPPED: warnTag, PARTIALLY_RECEIVED: warnTag,
  REJECTED: critTag, CANCELLED: critTag, CLOSED_SHORT: critTag,
};

const fieldClass = "min-h-[38px] w-full rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10";
const headClass = "bg-ground px-3.5 py-2.5 text-left text-[13px] font-medium text-gray-600";
const cellClass = "border-b border-line px-3.5 py-3 align-middle text-sm";
const btnClass = "inline-flex items-center rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const primaryBtnClass = "inline-flex items-center rounded-[10px] border border-ink bg-ink px-3.5 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";
const dangerBtnClass = "inline-flex items-center rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm font-medium text-crit transition hover:bg-crit-bg";

export default function VendorOrdersPage() {
  const { confirm, notify } = usePopup();
  const { user } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftItems, setDraftItems] = useState<OrderItem[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("labstock_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadData = useCallback(async () => {
    if (!user?.vendor) return;
    setLoading(true);
    try {
      const headers = getAuthHeaders();
      const [ordersResponse, suggestionsResponse] = await Promise.all([
        fetch("/api/purchase-orders", { headers }),
        fetch(`/api/purchase-orders/suggest?vendor=${encodeURIComponent(user.vendor)}`, { headers }),
      ]);
      if (ordersResponse.ok) setOrders(await ordersResponse.json());
      if (suggestionsResponse.ok) {
        const data = (await suggestionsResponse.json()) as Array<{
          item_id: string; name: string; unit: string; quantity: number; min_threshold: number; suggested_order_qty: number;
        }>;
        setSuggestions(data.map((item) => ({
          item_id: item.item_id,
          item_name: item.name,
          unit: item.unit,
          quantity: Number(item.suggested_order_qty),
          current_qty: Number(item.quantity),
          min_threshold: Number(item.min_threshold),
          suggested_order_qty: Number(item.suggested_order_qty),
        })));
      } else {
        const error = (await suggestionsResponse.json().catch(() => null)) as { error?: string } | null;
        void notify({ title: "เกิดข้อผิดพลาด", description: error?.error ?? "ไม่สามารถคำนวณรายการแนะนำได้ กรุณาลองใหม่อีกครั้ง", severity: "danger" });
      }
    } finally {
      setLoading(false);
    }
  }, [user?.vendor, notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const openNewProposal = () => {
    if (suggestions.length === 0) {
      void notify({ title: "ไม่มีรายการ", description: "ยังไม่มีน้ำยาที่ถึงจุดสั่งซื้อ", severity: "info" });
      return;
    }
    setEditingOrder(null);
    setDraftItems(suggestions.map(({ item_id, item_name, quantity, unit }) => ({ item_id, item_name, quantity, unit })));
    setDraftNote("เสนอรายการจากปริมาณคงเหลือปัจจุบัน");
  };

  const openRevision = (order: PurchaseOrder) => {
    setEditingOrder(order);
    setDraftItems(order.items.map(({ item_id, item_name, quantity, unit }) => ({ item_id, item_name, quantity: Number(quantity), unit })));
    setDraftNote(order.vendor_note ?? "");
  };

  const saveDraft = async () => {
    if (!user?.vendor || draftItems.length === 0 || draftItems.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) {
      void notify({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุจำนวนที่ถูกต้องทุกรายการ", severity: "warning" });
      return;
    }
    if (editingOrder && !draftNote.trim()) {
      void notify({ title: "ข้อมูลไม่ครบ", description: "กรุณาระบุเหตุผลที่แก้ไขรายการเพื่อให้ Lab ตรวจสอบ", severity: "warning" });
      return;
    }

    setSaving(true);
    try {
      const url = editingOrder ? `/api/purchase-orders/${editingOrder.id}` : "/api/purchase-orders";
      const response = await fetch(url, {
        method: editingOrder ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(editingOrder
          ? { action: "REQUEST_REVISION", vendor_note: draftNote, items: draftItems }
          : { vendor: user.vendor, note: draftNote, items: draftItems }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        void notify({ title: "เกิดข้อผิดพลาด", description: data?.error ?? "ส่งรายการไม่สำเร็จ", severity: "danger" });
        return;
      }
      setDraftItems([]);
      setDraftNote("");
      setEditingOrder(null);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const confirmLabOrder = async (order: PurchaseOrder) => {
    const action = order.status === "SUBMITTED" ? "ACKNOWLEDGE" : "CONFIRM_AVAILABILITY";
    const prompt = action === "ACKNOWLEDGE"
      ? "รับทราบใบสั่งซื้อและเริ่มตรวจสอบการจัดหาใช่หรือไม่?"
      : "ยืนยันว่า Vendor สามารถจัดรายการนี้ได้ตามเดิมหรือไม่?";
    const confirmed = await confirm({
      title: action === "ACKNOWLEDGE" ? "รับทราบใบสั่งซื้อ" : "ยืนยันการจัดหา",
      description: prompt,
      confirmLabel: action === "ACKNOWLEDGE" ? "รับทราบ" : "ยืนยัน",
    });
    if (!confirmed) return;
    const response = await fetch(`/api/purchase-orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      void notify({ title: "เกิดข้อผิดพลาด", description: "ยืนยันรายการไม่สำเร็จ", severity: "danger" });
      return;
    }
    await loadData();
  };

  const rejectLabOrder = async (order: PurchaseOrder) => {
    const reason = prompt("โปรดระบุเหตุผลที่ปฏิเสธใบสั่งน้ำยา");
    if (!reason?.trim()) return;
    const confirmed = await confirm({
      title: "ปฏิเสธใบสั่งน้ำยา",
      description: "ยืนยันการปฏิเสธใบสั่งน้ำยานี้หรือไม่?",
      confirmLabel: "ปฏิเสธ",
      destructive: true,
    });
    if (!confirmed) return;

    const response = await fetch(`/api/purchase-orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ action: "REJECT", vendor_note: reason.trim() }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      void notify({ title: "เกิดข้อผิดพลาด", description: data?.error ?? "ปฏิเสธรายการไม่สำเร็จ", severity: "danger" });
      return;
    }
    await loadData();
  };

  // The list payload lacks issuer and signer details, so print from the detail endpoint.
  // The window is opened synchronously in the click so popup blockers allow it.
  const printOrder = async (order: PurchaseOrder) => {
    let printWindow: Window | null = null;
    try {
      printWindow = openPurchaseOrderPrintWindow();
      const response = await fetch(`/api/purchase-orders/${order.id}`, { headers: getAuthHeaders() });
      const detail = response.ok ? await response.json() : order;
      printPurchaseOrderPdf(detail, { printWindow });
    } catch (error) {
      printWindow?.close();
      void notify({ title: "เกิดข้อผิดพลาด", description: error instanceof Error ? error.message : "ไม่สามารถเปิดหน้าพิมพ์ได้", severity: "danger" });
    }
  };

  if (!user || user.role !== "Vendor") return <div className="p-8 text-center text-gray-600">สิทธิ์การเข้าถึงเฉพาะ Vendor</div>;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[32px] leading-tight font-medium text-ink">สั่งน้ำยาและรับใบสั่งน้ำยา</h1>
          <p className="mt-1.5 text-[15px] text-gray-600">มุมมองบริษัทคู่ค้า · {user.vendor} · ตรวจปริมาณคงเหลือก่อนส่งรายการให้ Lab ยืนยัน</p>
        </div>
        <button type="button" onClick={() => void loadData()} className={btnClass}>รีเฟรช</button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(380px,1fr)_minmax(0,1.5fr)]">
        <section aria-labelledby="vendor-need-heading" className="min-w-0 rounded-2xl border border-line bg-white p-5">
          <div className="mb-3 flex flex-wrap items-start gap-3">
            <div className="mr-auto">
              <h2 id="vendor-need-heading" className="text-lg font-medium">น้ำยาที่ต้องพิจารณาสั่ง</h2>
              <p className="text-[13px] text-gray-600">ข้อมูลคงเหลือจากคลัง Lab</p>
            </div>
            <button type="button" onClick={openNewProposal} disabled={suggestions.length === 0} className={primaryBtnClass}>ส่งรายการเสนอให้ Lab ตรวจสอบ</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-separate border-spacing-0 text-left">
              <caption className="sr-only">น้ำยาที่ถึงจุดสั่งซื้อ</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${headClass} rounded-l-[10px]`}>น้ำยา</th>
                  <th scope="col" className={`${headClass} text-right`}>คงเหลือ</th>
                  <th scope="col" className={`${headClass} text-right`}>Min</th>
                  <th scope="col" className={`${headClass} rounded-r-[10px] text-right`}>แนะนำสั่ง</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((item) => (
                  <tr key={item.item_id}>
                    <td className={cellClass}><div className="font-medium">{item.item_name}</div><div className="text-xs text-gray-600">{item.item_id}</div></td>
                    <td className={`${cellClass} text-right text-crit`}>{item.current_qty} {item.unit}</td>
                    <td className={`${cellClass} text-right`}>{item.min_threshold}</td>
                    <td className={`${cellClass} text-right font-semibold`}>{item.suggested_order_qty} {item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && suggestions.length === 0 && (
            <div className="mt-3 rounded-xl border-[1.5px] border-dashed border-line px-3.5 py-10 text-sm text-gray-600">ไม่มีรายการที่ถึงจุดสั่งซื้อ</div>
          )}
        </section>

        <section aria-labelledby="vendor-orders-heading" className="min-w-0">
          <h2 id="vendor-orders-heading" className="mb-3 text-lg font-medium">รายการสั่งซื้อ</h2>
          {loading ? <p className="text-sm text-gray-600">กำลังโหลด...</p> : orders.map((order) => (
            <article key={order.id} className="mb-2.5 rounded-2xl border border-line bg-white px-[18px] py-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="flex-1 font-semibold">{order.po_number}</h3>
                <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-medium ${statusTone[order.status] ?? "bg-gray-200 text-ink"}`}>{statusLabel[order.status] ?? order.status}</span>
              </div>
              <p className="mb-2.5 mt-1 text-[13px] text-gray-600">
                {order.proposal_origin === "VENDOR" ? "Vendor เสนอรายการ" : "Lab สร้างใบสั่งน้ำยา"} · {order.items.length} รายการ
              </p>
              {order.vendor_note && <p className="mb-2.5 text-[13px] text-warn">หมายเหตุ: {order.vendor_note}</p>}
              {order.items.length > 0 && (
                <div className="mb-2.5 overflow-x-auto">
                  <table className="w-full min-w-[360px] border-separate border-spacing-0 text-left text-[13px]">
                    <caption className="sr-only">สั่ง ได้รับ และค้างของ {order.po_number}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="py-1.5 pr-3 font-medium text-gray-600">น้ำยา</th>
                        <th scope="col" className="px-3 py-1.5 text-right font-medium text-gray-600">สั่ง</th>
                        <th scope="col" className="px-3 py-1.5 text-right font-medium text-gray-600">ได้รับ</th>
                        <th scope="col" className="py-1.5 pl-3 text-right font-medium text-gray-600">ค้าง</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item) => {
                        const ordered = Number(item.quantity);
                        const received = Math.min(Number(item.received_qty ?? 0), ordered);
                        const outstanding = ordered - received;
                        return (
                          <tr key={item.item_id}>
                            <td className="border-t border-line py-1.5 pr-3">{item.item_name}</td>
                            <td className="border-t border-line px-3 py-1.5 text-right">{ordered} {item.unit}</td>
                            <td className="border-t border-line px-3 py-1.5 text-right text-ok">{received} {item.unit}</td>
                            <td className={`border-t border-line py-1.5 pl-3 text-right ${outstanding > 0 ? "font-semibold" : "text-gray-600"}`}>{outstanding} {item.unit}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => exportPurchaseOrderCsv(order)} className={btnClass}>Excel (CSV)</button>
                <button type="button" onClick={() => void printOrder(order)} className={btnClass}>บันทึก PDF</button>
                {(order.status === "SUBMITTED" || order.status === "ACKNOWLEDGED") && order.proposal_origin === "LAB" && (
                  <>
                    <button type="button" onClick={() => confirmLabOrder(order)} className={primaryBtnClass}>{order.status === "SUBMITTED" ? "รับทราบรายการ" : "ยืนยันจัดได้"}</button>
                    <button type="button" onClick={() => openRevision(order)} className={btnClass}>แก้ไขแล้วส่ง Lab</button>
                    <button type="button" onClick={() => void rejectLabOrder(order)} className={dangerBtnClass}>ปฏิเสธ</button>
                  </>
                )}
              </div>
            </article>
          ))}
          {!loading && orders.length === 0 && (
            <div className="rounded-2xl border border-line bg-white p-7 text-sm text-gray-600">ยังไม่มีใบสั่งสำหรับบริษัทนี้</div>
          )}
        </section>
      </div>

      {draftItems.length > 0 && (
        <div role="dialog" aria-modal="true" aria-labelledby="vendor-draft-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6">
            <h2 id="vendor-draft-title" className="text-[22px] font-medium">{editingOrder ? "แก้ไขรายการเพื่อส่ง Lab ตรวจสอบ" : "เสนอรายการสั่งน้ำยาให้ Lab"}</h2>
            <p className="mt-1 text-sm text-gray-600">Lab ต้องยืนยันก่อนรายการนี้จะเป็นคำสั่งซื้อที่ตกลงแล้ว</p>
            <div className="mt-4 space-y-2">
              {draftItems.map((item, index) => (
                <div key={item.item_id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                  <div className="flex-1"><div className="font-medium">{item.item_name}</div><div className="text-xs text-gray-600">{item.item_id}</div></div>
                  <input
                    aria-label={`จำนวน ${item.item_name}`}
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(event) => setDraftItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row))}
                    className={`${fieldClass} !w-24 text-right`}
                  />
                  <span className="w-12 text-sm text-gray-600">{item.unit}</span>
                </div>
              ))}
            </div>
            <label className="mt-4 flex flex-col gap-1.5 text-[13px] text-gray-600">
              หมายเหตุ{editingOrder ? " (จำเป็น)" : ""}
              <textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} className={fieldClass} rows={3} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setDraftItems([]); setEditingOrder(null); }} className={btnClass}>ยกเลิก</button>
              <button type="button" onClick={() => void saveDraft()} disabled={saving} className={primaryBtnClass}>{saving ? "กำลังส่ง..." : "ส่งให้ Lab ตรวจสอบ"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
