"use client";

import { useEffect, useMemo, useState } from "react";
import liff from "@line/liff";
import { CheckCircle2, ClipboardList, Loader2, Minus, PackageCheck, Plus, RefreshCw, Search, Send, ShieldCheck, ShoppingCart, XCircle } from "lucide-react";

type LinkedUser = { username: string; name: string; role: string };
type VendorOption = { vendor: string; item_count: number };
type CatalogItem = {
  item_id: string;
  name: string;
  unit: string;
  quantity: number;
  min_threshold: number;
  weekly_target: number;
  suggested_order_qty: number;
};
type DraftItem = { item_id: string; item_name: string; unit: string; quantity: number; current_qty?: number; min_threshold?: number };
type PurchaseOrder = {
  id: number;
  po_number: string;
  vendor: string;
  status: string;
  proposal_origin?: "LAB" | "VENDOR";
  vendor_note?: string | null;
  updated_at?: string;
  created_at?: string;
  items?: DraftItem[];
};

const statusLabel: Record<string, string> = {
  SUBMITTED: "ส่งให้ Vendor แล้ว",
  PENDING_LAB_REVIEW: "รอ Lab ตรวจ",
  REVISION_REQUESTED: "Vendor ขอแก้ไข",
  CONFIRMED: "Vendor ยืนยัน",
  PARTIALLY_SHIPPED: "ส่งบางส่วน",
  SHIPPED: "ส่งแล้ว",
  REJECTED: "ปฏิเสธ",
};

function makeRequestId() {
  return `liff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function LiffOrderWorkflow() {
  const [idToken, setIdToken] = useState("");
  const [user, setUser] = useState<LinkedUser | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendor, setVendor] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [note, setNote] = useState("");
  const [draftRequestId, setDraftRequestId] = useState(makeRequestId());
  const [tab, setTab] = useState<"create" | "track">("create");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const totalItems = draftItems.length;
  const totalUnits = useMemo(() => draftItems.reduce((sum, item) => sum + item.quantity, 0), [draftItems]);
  const reviewOrders = orders.filter((order) => order.status === "PENDING_LAB_REVIEW" || order.status === "REVISION_REQUESTED");

  const callApi = async <T,>(url: string, body: Record<string, unknown>, method = "POST") => {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, idToken }),
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error || "Request failed.");
    return result;
  };

  const refreshWorkspace = async (token = idToken) => {
    const response = await fetch("/api/liff/orders/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    const result = await response.json() as { user?: LinkedUser; vendors?: VendorOption[]; orders?: PurchaseOrder[]; error?: string };
    if (!response.ok || !result.user) throw new Error(result.error || "Unable to open LINE ordering.");
    setUser(result.user);
    setVendors(result.vendors ?? []);
    setOrders(result.orders ?? []);
    if (!vendor && result.vendors?.[0]?.vendor) setVendor(result.vendors[0].vendor);
  };

  useEffect(() => {
    const initialize = async () => {
      const liffId = process.env.NEXT_PUBLIC_LINE_ORDER_LIFF_ID?.trim();
      if (!liffId) {
        setError("ยังไม่ได้ตั้งค่า NEXT_PUBLIC_LINE_ORDER_LIFF_ID");
        setLoading(false);
        return;
      }

      try {
        await liff.init({ liffId, withLoginOnExternalBrowser: true });
        const token = liff.getIDToken();
        if (!token) throw new Error("ไม่พบข้อมูลยืนยันตัวตนจาก LINE");
        setIdToken(token);
        await refreshWorkspace(token);
      } catch (err) {
        setError(err instanceof Error ? err.message : "ไม่สามารถเปิดระบบสั่งน้ำยาผ่าน LINE ได้");
      } finally {
        setLoading(false);
      }
    };

    void initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSuggestions = async (suggestOnly = true) => {
    if (!vendor) {
      setError("เลือก Vendor ก่อน");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const rows = await callApi<CatalogItem[]>("/api/liff/orders/catalog/search", { vendor, keyword, suggestOnly });
      setCatalog(rows);
      if (suggestOnly && rows.length) {
        setDraftItems(rows.map((item) => ({
          item_id: item.item_id,
          item_name: item.name,
          unit: item.unit,
          quantity: Number(item.suggested_order_qty || 1),
          current_qty: Number(item.quantity),
          min_threshold: Number(item.min_threshold),
        })));
      }
      if (!rows.length) setMessage("ไม่มีรายการที่เข้าเงื่อนไข");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ค้นหารายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const addItem = (item: CatalogItem) => {
    setDraftItems((current) => {
      if (current.some((row) => row.item_id === item.item_id)) return current;
      return [...current, {
        item_id: item.item_id,
        item_name: item.name,
        unit: item.unit,
        quantity: Number(item.suggested_order_qty || 1),
        current_qty: Number(item.quantity),
        min_threshold: Number(item.min_threshold),
      }];
    });
  };

  const changeQty = (itemId: string, delta: number) => {
    setDraftItems((current) => current.map((item) => (
      item.item_id === itemId ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item
    )));
  };

  const removeItem = (itemId: string) => {
    setDraftItems((current) => current.filter((item) => item.item_id !== itemId));
  };

  const submitOrder = async () => {
    if (!vendor || !draftItems.length) {
      setError("เลือก Vendor และรายการก่อนส่งใบสั่งซื้อ");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const po = await callApi<PurchaseOrder>("/api/liff/orders", {
        vendor,
        items: draftItems,
        note,
        liffRequestId: draftRequestId,
      });
      setMessage(`ส่งใบสั่งซื้อ ${po.po_number} ให้ Vendor แล้ว`);
      setDraftItems([]);
      setCatalog([]);
      setNote("");
      setDraftRequestId(makeRequestId());
      await refreshWorkspace();
      setTab("track");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งใบสั่งซื้อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const reviewOrder = async (order: PurchaseOrder, status: "CONFIRMED" | "REJECTED") => {
    setBusy(true);
    setError("");
    try {
      await callApi<PurchaseOrder>(`/api/liff/orders/${order.id}`, { status }, "PATCH");
      setMessage(`${status === "CONFIRMED" ? "อนุมัติ" : "ปฏิเสธ"} ${order.po_number} แล้ว`);
      await refreshWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : "อัปเดตใบสั่งซื้อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center gap-3 bg-slate-950 px-6 text-sm font-bold text-white"><Loader2 className="animate-spin text-emerald-300" size={22} />กำลังเปิดเมนูสั่งน้ำยา...</div>;
  }

  if (error && !user) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-sm font-bold text-red-100">{error}</main>;
  }

  return (
    <main className="min-h-screen bg-[#0f172a] px-4 py-5 text-slate-950">
      <section className="mx-auto max-w-md overflow-hidden rounded-[28px] bg-slate-50 shadow-2xl shadow-black/30">
        <div className="bg-slate-950 px-5 py-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">LabStock LIFF</p>
              <h1 className="mt-2 text-2xl font-black">สั่งน้ำยา</h1>
              <p className="mt-1 text-xs text-slate-300">{user?.name || user?.username} · {user?.role}</p>
            </div>
            <button type="button" onClick={() => refreshWorkspace()} disabled={busy} className="rounded-2xl border border-white/10 bg-white/10 p-3 text-white">
              <RefreshCw size={18} className={busy ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setTab("create")} className={`rounded-2xl px-4 py-3 text-left text-sm font-black ${tab === "create" ? "bg-emerald-400 text-slate-950" : "bg-white/10 text-white"}`}>
              <ShoppingCart size={18} />สร้าง PO
            </button>
            <button type="button" onClick={() => setTab("track")} className={`rounded-2xl px-4 py-3 text-left text-sm font-black ${tab === "track" ? "bg-amber-300 text-slate-950" : "bg-white/10 text-white"}`}>
              <ClipboardList size={18} />ติดตาม
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {message && <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{message}</p>}
          {error && <p className="rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}

          {tab === "create" ? (
            <>
              <label className="block text-xs font-black uppercase text-slate-500">Vendor</label>
              <select value={vendor} onChange={(event) => { setVendor(event.target.value); setCatalog([]); setDraftItems([]); }} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500">
                {vendors.map((option) => <option key={option.vendor} value={option.vendor}>{option.vendor} · {option.item_count} รายการ</option>)}
              </select>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-4 text-slate-400" size={18} />
                  <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="ค้นหาน้ำยา/รหัส/บาร์โค้ด" className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-11 pr-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <button type="button" onClick={() => loadSuggestions(false)} disabled={busy} className="rounded-2xl bg-slate-900 px-4 text-white"><Search size={18} /></button>
              </div>

              <button type="button" onClick={() => loadSuggestions(true)} disabled={busy || !vendor} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-4 text-sm font-black text-white disabled:opacity-50">
                {busy ? <Loader2 className="animate-spin" size={18} /> : <PackageCheck size={18} />}
                แนะนำรายการใกล้หมด
              </button>

              {catalog.length > 0 && <div className="space-y-2">
                {catalog.map((item) => <button type="button" key={item.item_id} onClick={() => addItem(item)} className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left">
                  <div className="flex justify-between gap-3"><span className="text-sm font-black">{item.name}</span><span className="text-xs font-bold text-red-600">{item.quantity} {item.unit}</span></div>
                  <p className="mt-1 text-xs text-slate-500">{item.item_id} · แนะนำ {item.suggested_order_qty} {item.unit}</p>
                </button>)}
              </div>}

              <div className="rounded-3xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black">รายการที่จะสั่ง</h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{totalItems} รายการ · {totalUnits} หน่วย</span>
                </div>
                <div className="mt-3 space-y-3">
                  {draftItems.length === 0 && <p className="py-4 text-center text-sm font-bold text-slate-400">กดแนะนำรายการใกล้หมด หรือค้นหาเพิ่มเอง</p>}
                  {draftItems.map((item) => <div key={item.item_id} className="rounded-2xl border border-slate-100 p-3">
                    <div className="flex justify-between gap-3">
                      <div><p className="text-sm font-black">{item.item_name}</p><p className="mt-1 text-xs text-slate-500">เหลือ {item.current_qty ?? "-"} · Min {item.min_threshold ?? "-"}</p></div>
                      <button type="button" onClick={() => removeItem(item.item_id)} className="text-slate-400"><XCircle size={18} /></button>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => changeQty(item.item_id, -1)} className="rounded-full bg-slate-100 p-2"><Minus size={16} /></button>
                        <span className="w-16 text-center text-sm font-black">{item.quantity}</span>
                        <button type="button" onClick={() => changeQty(item.item_id, 1)} className="rounded-full bg-slate-100 p-2"><Plus size={16} /></button>
                      </div>
                      <span className="text-xs font-bold text-slate-500">{item.unit}</span>
                    </div>
                  </div>)}
                </div>
              </div>

              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="หมายเหตุถึง Vendor (ถ้ามี)" className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500" />
              <button type="button" onClick={submitOrder} disabled={busy || !draftItems.length} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-4 text-sm font-black text-white disabled:opacity-50">
                {busy ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                ส่งใบสั่งซื้อให้ Vendor
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded-3xl bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-amber-900"><ShieldCheck size={18} /><h2 className="text-sm font-black">รอตรวจจาก Lab {reviewOrders.length} ใบ</h2></div>
              </div>
              {orders.map((order) => <div key={order.id} className="rounded-3xl bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black">{order.po_number}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">{order.vendor} · {statusLabel[order.status] ?? order.status}</p>
                    {order.vendor_note && <p className="mt-2 rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">{order.vendor_note}</p>}
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{order.items?.length ?? 0}</span>
                </div>
                {(order.status === "PENDING_LAB_REVIEW" || order.status === "REVISION_REQUESTED") && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => reviewOrder(order, "CONFIRMED")} disabled={busy} className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-xs font-black text-white"><CheckCircle2 size={16} />อนุมัติ</button>
                    <button type="button" onClick={() => reviewOrder(order, "REJECTED")} disabled={busy} className="flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 py-3 text-xs font-black text-red-700"><XCircle size={16} />ปฏิเสธ</button>
                  </div>
                )}
              </div>)}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
