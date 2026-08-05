"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type OrderItem = { item_id: string; item_name: string; quantity: number; unit: string };
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
  items: OrderItem[];
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
};

export default function VendorOrdersPage() {
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
      }
    } finally {
      setLoading(false);
    }
  }, [user?.vendor]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const openNewProposal = () => {
    if (suggestions.length === 0) {
      alert("ยังไม่มีน้ำยาที่ถึงจุดสั่งซื้อ");
      return;
    }
    setEditingOrder(null);
    setDraftItems(suggestions.map(({ item_id, item_name, quantity, unit }) => ({ item_id, item_name, quantity, unit })));
    setDraftNote("เสนอรายการจากปริมาณคงเหลือปัจจุบัน");
  };

  const openRevision = (order: PurchaseOrder) => {
    setEditingOrder(order);
    setDraftItems(order.items.map((item) => ({ ...item, quantity: Number(item.quantity) })));
    setDraftNote(order.vendor_note ?? "");
  };

  const saveDraft = async () => {
    if (!user?.vendor || draftItems.length === 0 || draftItems.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) {
      alert("กรุณาระบุจำนวนที่ถูกต้องทุกรายการ");
      return;
    }
    if (editingOrder && !draftNote.trim()) {
      alert("กรุณาระบุเหตุผลที่แก้ไขรายการเพื่อให้ Lab ตรวจสอบ");
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
        alert(data?.error ?? "ส่งรายการไม่สำเร็จ");
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
    if (!confirm(prompt)) return;
    const response = await fetch(`/api/purchase-orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      alert("ยืนยันรายการไม่สำเร็จ");
      return;
    }
    await loadData();
  };

  if (!user || user.role !== "Vendor") return <div className="p-8 text-center">สิทธิ์การเข้าถึงเฉพาะ Vendor</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">สั่งน้ำยาและรับใบสั่งน้ำยา</h1>
          <p className="text-sm text-gray-500">{user.vendor} · ตรวจปริมาณคงเหลือก่อนส่งรายการให้ Lab ยืนยัน</p>
        </div>
        <button onClick={() => void loadData()} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50">รีเฟรช</button>
      </div>

      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="flex flex-col justify-between gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div><h2 className="font-bold">น้ำยาที่ต้องพิจารณาสั่ง</h2><p className="text-sm text-gray-500">ข้อมูลคงเหลือจากคลัง Lab</p></div>
          <button onClick={openNewProposal} disabled={suggestions.length === 0} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">ส่งรายการเสนอให้ Lab ตรวจสอบ</button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-gray-500"><tr><th className="px-4 py-3">น้ำยา</th><th className="px-4 py-3 text-right">คงเหลือ</th><th className="px-4 py-3 text-right">Min</th><th className="px-4 py-3 text-right">แนะนำสั่ง</th></tr></thead>
            <tbody>{suggestions.map((item) => <tr key={item.item_id} className="border-t"><td className="px-4 py-3"><div className="font-medium">{item.item_name}</div><div className="text-xs text-gray-500">{item.item_id}</div></td><td className="px-4 py-3 text-right">{item.current_qty} {item.unit}</td><td className="px-4 py-3 text-right">{item.min_threshold}</td><td className="px-4 py-3 text-right font-semibold text-indigo-700">{item.suggested_order_qty} {item.unit}</td></tr>)}</tbody>
          </table>
          {!loading && suggestions.length === 0 && <p className="p-6 text-center text-sm text-gray-500">ไม่มีรายการที่ถึงจุดสั่งซื้อ</p>}
        </div>
      </section>

      <section className="space-y-3"><h2 className="font-bold">รายการสั่งซื้อ</h2>
        {loading ? <p className="text-sm text-gray-500">กำลังโหลด...</p> : orders.map((order) => (
          <article key={order.id} className="rounded-xl border bg-white p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{order.po_number}</h3><span className="rounded bg-gray-100 px-2 py-1 text-xs">{statusLabel[order.status] ?? order.status}</span></div><p className="mt-1 text-sm text-gray-500">{order.proposal_origin === "VENDOR" ? "Vendor เสนอรายการ" : "Lab สร้างใบสั่งน้ำยา"} · {order.items.length} รายการ</p>{order.vendor_note && <p className="mt-2 text-sm text-amber-700">หมายเหตุ: {order.vendor_note}</p>}</div>
              {(order.status === "SUBMITTED" || order.status === "ACKNOWLEDGED") && order.proposal_origin === "LAB" && <div className="flex gap-2"><button onClick={() => confirmLabOrder(order)} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white">{order.status === "SUBMITTED" ? "รับทราบรายการ" : "ยืนยันจัดได้"}</button><button onClick={() => openRevision(order)} className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-700">แก้ไขแล้วส่ง Lab</button></div>}
            </div>
          </article>
        ))}
        {!loading && orders.length === 0 && <p className="text-sm text-gray-500">ยังไม่มีรายการสั่งซื้อ</p>}
      </section>

      {draftItems.length > 0 && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6"><h2 className="text-xl font-bold">{editingOrder ? "แก้ไขรายการเพื่อส่ง Lab ตรวจสอบ" : "เสนอรายการสั่งน้ำยาให้ Lab"}</h2><p className="mt-1 text-sm text-gray-500">Lab ต้องยืนยันก่อนรายการนี้จะเป็นคำสั่งซื้อที่ตกลงแล้ว</p>
        <div className="mt-4 space-y-2">{draftItems.map((item, index) => <div key={item.item_id} className="flex items-center gap-3 rounded border p-3"><div className="flex-1"><div className="font-medium">{item.item_name}</div><div className="text-xs text-gray-500">{item.item_id}</div></div><input aria-label={`จำนวน ${item.item_name}`} type="number" min="1" value={item.quantity} onChange={(event) => setDraftItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row))} className="w-24 rounded border p-2 text-right"/><span className="w-12 text-sm text-gray-500">{item.unit}</span></div>)}</div>
        <label className="mt-4 block text-sm font-medium">หมายเหตุ{editingOrder ? " (จำเป็น)" : ""}</label><textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} className="mt-1 w-full rounded border p-2" rows={3}/>
        <div className="mt-5 flex justify-end gap-2"><button onClick={() => { setDraftItems([]); setEditingOrder(null); }} className="rounded border px-4 py-2">ยกเลิก</button><button onClick={() => void saveDraft()} disabled={saving} className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">{saving ? "กำลังส่ง..." : "ส่งให้ Lab ตรวจสอบ"}</button></div>
      </div></div>}
    </div>
  );
}
