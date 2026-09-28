"use client";

import { useEffect, useMemo, useState } from "react";
import liff from "@line/liff";
import { Check, ClipboardList, Loader2, PackageCheck, RefreshCw, Search, Send, ShieldCheck, ShoppingCart, X, XCircle } from "lucide-react";
import QtyStepper from "@/components/mobile/qty-stepper";

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
  policy_order_qty: number;
  dynamic_order_qty: number;
  variance_percent: number | null;
  confidence: "high" | "low" | "none";
  review_reasons: string[];
  auto_selectable: boolean;
  /** False for reagents without an order policy: manual quantity with a reason only. */
  policy_configured?: boolean;
  expedite_required: boolean;
  projected_balance_at_horizon: number;
  safety_stock_boxes: number;
  lead_time_days: number;
  horizon_days: number;
  expiry_assessment: {
    expired_qty_excluded: number;
    expiring_within_horizon_qty: number;
    nearest_expiry_date: string | null;
  };
  calculation_breakdown: { demandSource: string; dailyDemandBoxes: number };
};
type DraftItem = {
  item_id: string;
  item_name: string;
  unit: string;
  quantity: number;
  current_qty?: number;
  min_threshold?: number;
  policy_order_qty?: number;
  dynamic_order_qty?: number;
  selected_basis?: "POLICY" | "DYNAMIC" | "MANUAL";
  override_reason?: string;
  confidence?: "high" | "low" | "none";
  review_reasons?: string[];
  policy_configured?: boolean;
  suggestion_context?: Pick<CatalogItem, "projected_balance_at_horizon" | "safety_stock_boxes" | "lead_time_days" | "horizon_days" | "expiry_assessment" | "calculation_breakdown">;
};
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
  PENDING_MANAGER_REVIEW: "รอหัวหน้าตรวจ",
  SUBMITTED: "ส่งให้ Vendor แล้ว",
  ACKNOWLEDGED: "Vendor รับทราบ",
  PENDING_LAB_REVIEW: "รอ Lab ตรวจ",
  REVISION_REQUESTED: "Vendor ขอแก้ไข",
  CONFIRMED: "Vendor ยืนยัน",
  PARTIALLY_SHIPPED: "ส่งบางส่วน",
  SHIPPED: "ส่งแล้ว",
  REJECTED: "ปฏิเสธ",
  CANCELLED: "ยกเลิกแล้ว",
  CLOSED_SHORT: "ปิดใบ (ได้รับไม่ครบ)",
};

/** Statuses that need somebody to act, shown in the amber tone. */
const ATTENTION_STATUSES = new Set(["PENDING_MANAGER_REVIEW", "PENDING_LAB_REVIEW", "REVISION_REQUESTED"]);

const fieldClass =
  "min-h-12 w-full rounded-xl border border-line bg-white px-3.5 text-base outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10";

const primaryButtonClass =
  "flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[14px] bg-line-green-ink px-4 font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

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
        const selectable = rows.filter((item) => item.auto_selectable);
        const heldForReview = rows.filter((item) => !item.auto_selectable);
        setDraftItems(selectable.map((item) => ({
          item_id: item.item_id,
          item_name: item.name,
          unit: item.unit,
          quantity: Number(item.suggested_order_qty || 1),
          current_qty: Number(item.quantity),
          min_threshold: Number(item.min_threshold),
          policy_order_qty: Number(item.policy_order_qty),
          dynamic_order_qty: Number(item.dynamic_order_qty),
          selected_basis: "POLICY",
          confidence: item.confidence,
          review_reasons: item.review_reasons,
          suggestion_context: {
            projected_balance_at_horizon: item.projected_balance_at_horizon,
            safety_stock_boxes: item.safety_stock_boxes,
            lead_time_days: item.lead_time_days,
            horizon_days: item.horizon_days,
            expiry_assessment: item.expiry_assessment,
            calculation_breakdown: item.calculation_breakdown,
          },
        })));
        if (heldForReview.length) setMessage(`พักไว้ให้ตรวจเอง ${heldForReview.length} รายการ: ${heldForReview.map((item) => item.name).join(", ")}`);
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
        policy_order_qty: Number(item.policy_order_qty),
        dynamic_order_qty: Number(item.dynamic_order_qty),
        selected_basis: item.auto_selectable && item.policy_order_qty > 0 ? "POLICY" : "MANUAL",
        confidence: item.confidence,
        review_reasons: item.review_reasons,
        policy_configured: item.policy_configured !== false,
        suggestion_context: {
          projected_balance_at_horizon: item.projected_balance_at_horizon,
          safety_stock_boxes: item.safety_stock_boxes,
          lead_time_days: item.lead_time_days,
          horizon_days: item.horizon_days,
          expiry_assessment: item.expiry_assessment,
          calculation_breakdown: item.calculation_breakdown,
        },
      }];
    });
  };

  // Any change to the quantity is a manual override, which then requires a reason. The value can be 0 while typing; submit rejects it.
  const setQuantity = (itemId: string, quantity: number) => {
    setDraftItems((current) => current.map((item) => (
      item.item_id === itemId && item.quantity !== quantity ? { ...item, quantity: Math.max(0, quantity), selected_basis: "MANUAL" } : item
    )));
  };

  const chooseQuantityBasis = (itemId: string, basis: "POLICY" | "DYNAMIC") => {
    setDraftItems((current) => current.map((item) => item.item_id === itemId
      ? {
        ...item,
        quantity: Number(basis === "POLICY" ? item.policy_order_qty : item.dynamic_order_qty),
        selected_basis: basis,
        override_reason: "",
      }
      : item));
  };

  const removeItem = (itemId: string) => {
    setDraftItems((current) => current.filter((item) => item.item_id !== itemId));
  };

  const submitOrder = async () => {
    if (!vendor || !draftItems.length) {
      setError("เลือก Vendor และรายการก่อนส่งใบสั่งซื้อ");
      return;
    }
    const zeroQuantity = draftItems.find((item) => !(item.quantity > 0));
    if (zeroQuantity) {
      setError(`กรุณาระบุจำนวนมากกว่า 0 ของ ${zeroQuantity.item_name}`);
      return;
    }
    const missingReason = draftItems.find((item) => item.selected_basis === "MANUAL" && !item.override_reason?.trim());
    if (missingReason) {
      setError(`กรุณาระบุเหตุผลที่แก้จำนวนของ ${missingReason.item_name}`);
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
      // A Lab-created PO waits for a Manager review before the Vendor can see it.
      setMessage(`สร้างใบสั่งซื้อ ${po.po_number} แล้ว รอหัวหน้าตรวจก่อนส่งให้ Vendor`);
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
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 bg-ground px-6 text-sm text-ink-muted" aria-live="polite">
        <Loader2 className="animate-spin text-line-green-ink" size={22} />
        กำลังเปิดเมนูสั่งน้ำยา...
      </div>
    );
  }

  if (error && !user) {
    return <main className="flex min-h-screen items-center justify-center bg-ground px-6 text-center text-sm font-medium text-crit" role="alert">{error}</main>;
  }

  const reviewPanel = reviewOrders.length > 0 && (
    <section className="rounded-2xl bg-warn-bg p-3.5" aria-label="ใบสั่งซื้อรอ Lab ตรวจ">
      <div className="flex items-center gap-2 text-warn"><ShieldCheck size={18} /><h2 className="text-sm font-semibold">รอตรวจจาก Lab {reviewOrders.length} ใบ</h2></div>
      <div className="mt-2.5 space-y-2.5">
        {reviewOrders.map((order) => (
          <div key={order.id} className="rounded-xl bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">{order.po_number}</p>
              <p className="truncate text-xs text-ink-muted">{order.vendor}</p>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">{statusLabel[order.status] ?? order.status} · {order.items?.length ?? 0} รายการ</p>
            {order.items && order.items.length > 0 && (
              <p className="mt-1 text-xs text-ink-muted">{order.items.map((item) => `${item.item_name} ×${item.quantity}`).join(" · ")}</p>
            )}
            {order.vendor_note && <p className="mt-2 rounded-lg bg-warn-bg p-2.5 text-xs font-medium text-warn">{order.vendor_note}</p>}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => reviewOrder(order, "CONFIRMED")} disabled={busy} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-line-green-ink text-sm font-semibold text-white disabled:opacity-50"><Check size={16} />อนุมัติ</button>
              <button type="button" onClick={() => reviewOrder(order, "REJECTED")} disabled={busy} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-crit/30 bg-crit-bg text-sm font-semibold text-crit disabled:opacity-50"><X size={16} />ปฏิเสธ</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <main className={`min-h-screen bg-ground text-ink ${tab === "create" && draftItems.length > 0 ? "pb-[calc(8rem+env(safe-area-inset-bottom))]" : "pb-8"}`}>
      <div className="mx-auto max-w-md space-y-3 px-4 pt-[max(0.875rem,env(safe-area-inset-top))]">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-ink-muted">{user?.name || user?.username} · {user?.role}</p>
            <h1 className="text-2xl font-semibold">สั่งน้ำยา</h1>
          </div>
          <button type="button" onClick={() => refreshWorkspace()} disabled={busy} aria-label="โหลดข้อมูลใหม่" className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-white disabled:opacity-50">
            <RefreshCw size={17} className={busy ? "animate-spin" : ""} />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-white p-1" role="tablist" aria-label="เมนูสั่งน้ำยา">
          <button type="button" role="tab" aria-selected={tab === "create"} onClick={() => setTab("create")} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium ${tab === "create" ? "bg-ink text-white" : "text-ink-muted"}`}>
            <ShoppingCart size={16} />สร้าง PO
          </button>
          <button type="button" role="tab" aria-selected={tab === "track"} onClick={() => setTab("track")} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium ${tab === "track" ? "bg-ink text-white" : "text-ink-muted"}`}>
            <ClipboardList size={16} />ติดตาม
            {reviewOrders.length > 0 && <span className="rounded-full bg-crit px-1.5 text-[11px] leading-5 text-white">{reviewOrders.length}</span>}
          </button>
        </div>

        {message && <p className="rounded-2xl border border-ok/25 bg-ok-bg p-3.5 text-sm font-medium text-ok" role="status">{message}</p>}
        {error && <p className="rounded-2xl border border-crit/25 bg-crit-bg p-3.5 text-sm font-medium text-crit" role="alert">{error}</p>}

        {tab === "create" ? (
          <>
            {reviewPanel}

            <section className="space-y-2.5 rounded-[18px] border border-line bg-white p-3.5">
              <label htmlFor="liff-order-vendor" className="block text-xs font-medium text-ink-muted">Vendor</label>
              <select id="liff-order-vendor" value={vendor} onChange={(event) => { setVendor(event.target.value); setCatalog([]); setDraftItems([]); }} className={fieldClass}>
                {vendors.map((option) => <option key={option.vendor} value={option.vendor}>{option.vendor} · {option.item_count} รายการ</option>)}
              </select>

              <div className="grid grid-cols-[minmax(0,1fr)_48px] gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a8d91]" size={18} />
                  <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="ค้นหาน้ำยา/รหัส/บาร์โค้ด" aria-label="ค้นหาน้ำยา" enterKeyHint="search" className={`${fieldClass} pl-10`} />
                </div>
                <button type="button" onClick={() => loadSuggestions(false)} disabled={busy} aria-label="ค้นหา" className="flex items-center justify-center rounded-xl bg-ink text-white disabled:opacity-50"><Search size={18} /></button>
              </div>

              <button type="button" onClick={() => loadSuggestions(true)} disabled={busy || !vendor} className={primaryButtonClass}>
                {busy ? <Loader2 className="animate-spin" size={18} /> : <PackageCheck size={18} />}
                แนะนำรายการใกล้หมด
              </button>
            </section>

            {catalog.length > 0 && (
              <section className="space-y-2" aria-label="ผลการค้นหา">
                {catalog.map((item) => (
                  <button type="button" key={item.item_id} onClick={() => addItem(item)} className="w-full rounded-2xl border border-line bg-white p-3 text-left active:scale-[0.99]">
                    <div className="flex justify-between gap-3"><span className="text-sm font-medium">{item.name}</span><span className="shrink-0 text-xs font-medium text-crit">{item.quantity} {item.unit}</span></div>
                    <p className="mt-1 text-xs text-ink-muted">{item.item_id} · แล็บอนุมัติ {item.policy_order_qty} · คำนวณสด {item.dynamic_order_qty} {item.unit}</p>
                    {item.policy_configured === false && <p className="mt-1 text-xs font-medium text-crit">ยังไม่ได้ตั้งนโยบายสั่งซื้อ — เพิ่มได้ แต่ต้องระบุเหตุผล</p>}
                    {!item.auto_selectable && item.review_reasons.some((reason) => reason !== "NO_ORDER_POLICY") && <p className="mt-1 text-xs font-medium text-warn">ตรวจสอบเองก่อนเลือก: {item.review_reasons.filter((reason) => reason !== "NO_ORDER_POLICY").join(", ")}</p>}
                  </button>
                ))}
              </section>
            )}

            <section className="rounded-[18px] border border-line bg-white p-3.5" aria-labelledby="order-lines-heading">
              <div className="flex items-center justify-between gap-3">
                <h2 id="order-lines-heading" className="font-semibold">รายการที่จะสั่ง</h2>
                <span className="rounded-full bg-[#f6f6f7] px-2.5 py-1 text-xs font-medium">{totalItems} รายการ · {totalUnits} หน่วย</span>
              </div>
              <div className="mt-3 space-y-3">
                {draftItems.length === 0 && <p className="py-4 text-center text-sm text-ink-muted">กดแนะนำรายการใกล้หมด หรือค้นหาเพิ่มเอง</p>}
                {draftItems.map((item) => (
                  <div key={item.item_id} className="rounded-2xl border border-[#ececee] p-3">
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{item.item_name}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">เหลือ {item.current_qty ?? "-"} · Min {item.min_threshold ?? "-"}</p>
                      </div>
                      <button type="button" onClick={() => removeItem(item.item_id)} aria-label={`เอา ${item.item_name} ออก`} className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center text-ink-muted"><XCircle size={18} /></button>
                    </div>

                    {item.policy_order_qty !== undefined && item.policy_configured !== false && (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <button type="button" onClick={() => chooseQuantityBasis(item.item_id, "POLICY")} aria-pressed={item.selected_basis === "POLICY"} className={`min-h-11 rounded-xl border p-2 text-left ${item.selected_basis === "POLICY" ? "border-line-green-ink bg-[#e6f9ee]" : "border-line"}`}>
                          <span className="block text-[11px] text-ink-muted">แล็บอนุมัติ</span><span className="font-semibold">{item.policy_order_qty}</span>
                        </button>
                        <button type="button" onClick={() => chooseQuantityBasis(item.item_id, "DYNAMIC")} disabled={!item.dynamic_order_qty} aria-pressed={item.selected_basis === "DYNAMIC"} className={`min-h-11 rounded-xl border p-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${item.selected_basis === "DYNAMIC" ? "border-ink bg-[#f6f6f7]" : "border-line"}`}>
                          <span className="block text-[11px] text-ink-muted">คำนวณสด</span><span className="font-semibold">{item.dynamic_order_qty}</span>
                        </button>
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-ink-muted">จำนวนที่สั่ง ({item.unit})</p>
                      <QtyStepper value={item.quantity} onChange={(value) => setQuantity(item.item_id, value)} label={`จำนวน ${item.item_name}`} />
                    </div>

                    {item.policy_order_qty !== undefined && item.policy_configured !== false && (
                      <div className="mt-2 space-y-1.5 text-xs text-ink-muted">
                        <p>ความเชื่อมั่น {item.confidence === "high" ? "สูง" : item.confidence === "low" ? "ต่ำ" : "ยังไม่มีข้อมูล"}</p>
                        {item.suggestion_context && <p className="rounded-lg bg-[#f6f6f7] p-2">รอบสั่ง {item.suggestion_context.horizon_days} วัน; ระยะรอของ {item.suggestion_context.lead_time_days} วัน: คาดเหลือ {item.suggestion_context.projected_balance_at_horizon} {item.unit}, Safety stock {item.suggestion_context.safety_stock_boxes} {item.unit}; ใช้ {item.suggestion_context.calculation_breakdown.dailyDemandBoxes} {item.unit}/วัน{item.suggestion_context.expiry_assessment.expired_qty_excluded > 0 ? ` · ไม่นับหมดอายุแล้ว ${item.suggestion_context.expiry_assessment.expired_qty_excluded} ${item.unit}` : ""}{item.suggestion_context.expiry_assessment.expiring_within_horizon_qty > 0 ? ` · FEFO: ใกล้หมดอายุ ${item.suggestion_context.expiry_assessment.expiring_within_horizon_qty} ${item.unit}` : ""}</p>}
                        {!!item.review_reasons?.length && <p className="font-medium text-warn">ทบทวน: {item.review_reasons.join(", ")}</p>}
                      </div>
                    )}
                    {item.policy_configured === false && <p className="mt-2 text-xs font-medium text-crit">ยังไม่ได้ตั้งนโยบายสั่งซื้อ — เพิ่มได้ แต่ต้องระบุเหตุผล</p>}
                    {item.selected_basis === "MANUAL" && (
                      <input value={item.override_reason ?? ""} onChange={(event) => setDraftItems((current) => current.map((row) => row.item_id === item.item_id ? { ...row, override_reason: event.target.value } : row))} placeholder={item.policy_configured === false ? "เหตุผลที่สั่ง (ยังไม่มีนโยบายสั่งซื้อ)*" : "เหตุผลที่แก้จำนวน*"} aria-label="เหตุผลที่สั่ง" className="mt-2.5 min-h-11 w-full rounded-xl border border-warn/40 bg-warn-bg px-3 text-base outline-none focus:border-ink" />
                    )}
                  </div>
                ))}
              </div>
            </section>

            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="หมายเหตุถึง Vendor (ถ้ามี)" aria-label="หมายเหตุถึง Vendor" className="min-h-24 w-full rounded-2xl border border-line bg-white p-3.5 text-base outline-none focus:border-ink focus:ring-2 focus:ring-ink/10" />
          </>
        ) : (
          <div className="space-y-3">
            {reviewPanel}
            {orders.length === 0 && <p className="rounded-2xl border border-dashed border-line bg-white/60 p-6 text-center text-sm text-ink-muted">ยังไม่มีใบสั่งซื้อที่กำลังดำเนินการ</p>}
            {orders.filter((order) => !reviewOrders.includes(order)).map((order) => {
              const attention = ATTENTION_STATUSES.has(order.status);
              return (
                <div key={order.id} className="rounded-2xl border border-line bg-white p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{order.po_number}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">{order.vendor}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${attention ? "bg-warn-bg text-warn" : "bg-[#f6f6f7] text-ink"}`}>{statusLabel[order.status] ?? order.status}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-muted">{order.items?.length ?? 0} รายการ</p>
                  {order.vendor_note && <p className="mt-2 rounded-xl bg-warn-bg p-2.5 text-xs font-medium text-warn">{order.vendor_note}</p>}
                  {order.status === "PENDING_MANAGER_REVIEW" && (
                    <a href={`/orders/${order.id}`} className="mt-2.5 flex min-h-11 items-center justify-center rounded-xl border border-line text-sm font-medium text-ink!">อนุมัติได้ที่หน้าเว็บ LabStock</a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {tab === "create" && draftItems.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white px-4 pt-3 pb-[calc(1.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-md">
            <button type="button" onClick={submitOrder} disabled={busy} className={primaryButtonClass}>
              {busy ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
              ส่งใบสั่งให้หัวหน้าตรวจ ({draftItems.length} รายการ)
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
