"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle,
  ClipboardList,
  Loader2,
  Search,
  ShoppingCart,
  Smile,
  Trash2,
  XCircle,
} from "lucide-react";
import Modal from "@/components/modal";
import MultiSelect from "@/components/multi-select";
import { apiClient, type BatchItem, type CountWorkOrderSummary, type Reagent } from "@/lib/api-client";

interface CountItem extends Reagent {
  actual: number | "";
  refilled?: boolean;
  submitting?: boolean;
}

interface RefillPreviewItem {
  item: CountItem;
  actual: number;
  needed: number;
  dispensed: number;
  shortage: number;
  lots: BatchItem[];
}

interface RefillPreview {
  items: RefillPreviewItem[];
  batchItems: BatchItem[];
  totalNeeded: number;
  totalDispensed: number;
  totalShortage: number;
}

const COUNT_STORAGE_KEY = "labstock_counts";

const WORK_ORDER_STATE: Record<CountWorkOrderSummary["status"], { label: string; className: string }> = {
  OPEN: { label: "กำลังนับ", className: "bg-warn-bg text-warn" },
  CONFIRMED: { label: "เสร็จแล้ว", className: "bg-ok-bg text-ok" },
  CANCELLED: { label: "ยกเลิก", className: "bg-gray-100 text-gray-700" },
};

const formatShortDate = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "short", year: "2-digit" }).format(date);
};

const sortLotsByFefo = (lots: Reagent["lots"]) => {
  return [...lots].sort((a, b) => {
    const expiry = new Date(a.expDate).getTime() - new Date(b.expDate).getTime();
    if (expiry !== 0) return expiry;
    const received = new Date(a.receivedOn).getTime() - new Date(b.receivedOn).getTime();
    if (received !== 0) return received;
    return a.inventoryId - b.inventoryId;
  });
};

const buildRefillPreview = (items: CountItem[]): RefillPreview => {
  const previewItems = items.map((item) => {
    const actual = item.actual === "" ? 0 : item.actual;
    const needed = Math.max(item.weeklyTarget - actual, 0);
    let remaining = needed;
    const lots: BatchItem[] = [];

    for (const lot of sortLotsByFefo(item.lots)) {
      if (remaining <= 0) break;
      const qty = Math.min(remaining, lot.qty);
      if (qty <= 0) continue;
      lots.push({
        inventoryId: lot.inventoryId,
        itemId: item.itemId,
        name: item.name,
        lotNo: lot.lotNo,
        qty,
        unit: item.unit,
        expDate: lot.expDate,
        receivedOn: lot.receivedOn,
        note: "เบิกเติมหน้างาน (Sync รวม)",
      });
      remaining -= qty;
    }

    const dispensed = lots.reduce((sum, lot) => sum + lot.qty, 0);
    return { item, actual, needed, dispensed, shortage: Math.max(needed - dispensed, 0), lots };
  });

  return {
    items: previewItems,
    batchItems: previewItems.flatMap((item) => item.lots),
    totalNeeded: previewItems.reduce((sum, item) => sum + item.needed, 0),
    totalDispensed: previewItems.reduce((sum, item) => sum + item.dispensed, 0),
    totalShortage: previewItems.reduce((sum, item) => sum + item.shortage, 0),
  };
};

export default function CountPage() {
  const { user, loading: authLoading } = useAuth();
  const [reagents, setReagents] = useState<CountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string[]>(["ALL"]);
  const [filterJob, setFilterJob] = useState<string[]>(["ALL"]);
  const [filterVendor, setFilterVendor] = useState<string[]>(["ALL"]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [preview, setPreview] = useState<RefillPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingWorkOrder, setSavingWorkOrder] = useState(false);
  const [workOrders, setWorkOrders] = useState<CountWorkOrderSummary[]>([]);

  const mergeDashboardState = useCallback((dashboard: Reagent[], previous: CountItem[], clearIds: string[] = [], refilledIds: string[] = []) => {
    const previousMap = new Map(previous.map((item) => [item.itemId, item]));
    const clearSet = new Set(clearIds);
    const refilledSet = new Set(refilledIds);
    return dashboard.map((item) => ({
      ...item,
      actual: clearSet.has(item.itemId) ? "" : (previousMap.get(item.itemId)?.actual ?? ""),
      refilled: refilledSet.has(item.itemId) || previousMap.get(item.itemId)?.refilled || false,
      submitting: false,
    }));
  }, []);

  const refreshFromServer = useCallback(async (clearIds: string[] = [], refilledIds: string[] = []) => {
    const dashboard = await apiClient.getDashboard();
    setReagents((previous) => mergeDashboardState(dashboard, previous, clearIds, refilledIds));
  }, [mergeDashboardState]);

  useEffect(() => {
    if (authLoading || !user) return;
    apiClient.getDashboard().then((dashboard) => {
      const saved = JSON.parse(localStorage.getItem(COUNT_STORAGE_KEY) || "{}") as Record<string, number>;
      setReagents(dashboard.map((item) => ({
        ...item,
        actual: saved[item.itemId] ?? "",
        refilled: false,
        submitting: false,
      })));
    }).catch((error) => {
      console.error(error);
      setFeedback({ type: "error", msg: "โหลดรายการน้ำยาไม่สำเร็จ" });
    }).finally(() => setLoading(false));
  }, [authLoading, user]);

  useEffect(() => {
    if (!reagents.length) return;
    const saved: Record<string, number> = {};
    reagents.forEach((item) => {
      if (item.actual !== "") saved[item.itemId] = item.actual;
    });
    localStorage.setItem(COUNT_STORAGE_KEY, JSON.stringify(saved));
  }, [reagents]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    apiClient.listCountWorkOrders().then((orders) => {
      if (!cancelled) setWorkOrders(orders);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [authLoading, user]);

  const categories = useMemo(() => ({
    types: Array.from(new Set(reagents.map((item) => item.reagentType).filter(Boolean))).sort(),
    jobs: Array.from(new Set(reagents.map((item) => item.jobType).filter(Boolean))).sort(),
    vendors: Array.from(new Set(reagents.map((item) => item.vendor).filter((vendor): vendor is string => Boolean(vendor)))).sort(),
  }), [reagents]);

  const filteredItems = useMemo(() => reagents.filter((item) => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const searchText = `${item.itemId} ${item.name} ${item.qrCode || ""}`.toLowerCase();
    return (terms.length === 0 || terms.every((term) => searchText.includes(term)))
      && (filterType.includes("ALL") || filterType.includes(item.reagentType))
      && (filterJob.includes("ALL") || filterJob.includes(item.jobType))
      && (filterVendor.includes("ALL") || filterVendor.includes(item.vendor ?? ""));
  }), [filterJob, filterType, filterVendor, reagents, search]);

  const countedCount = reagents.filter((item) => item.actual !== "").length;
  const progress = reagents.length ? (countedCount / reagents.length) * 100 : 0;
  const refillItems = reagents.filter((item) => item.actual !== "" && item.actual < item.weeklyTarget && !item.refilled);

  const handleInput = (itemId: string, value: string) => {
    const actual = value === "" ? "" : Math.max(0, Number.parseInt(value.replace(/[^0-9]/g, ""), 10) || 0);
    setReagents((items) => items.map((item) => item.itemId === itemId ? { ...item, actual, refilled: false } : item));
  };

  const handleClearAll = () => {
    if (!window.confirm("ต้องการล้างยอดนับค้างทั้งหมดหรือไม่? รายการในคลังและประวัติการเบิกจะไม่ถูกเปลี่ยน")) return;
    setReagents((items) => items.map((item) => ({ ...item, actual: "", refilled: false })));
    localStorage.removeItem(COUNT_STORAGE_KEY);
    setFeedback({ type: "success", msg: "ล้างยอดนับค้างแล้ว" });
  };

  const openPreview = (items: CountItem[]) => {
    const nextPreview = buildRefillPreview(items);
    if (!nextPreview.batchItems.length) {
      setFeedback({ type: "error", msg: "สต็อกคลังกลางไม่พอ ไม่มี Lot ที่สามารถเบิกเติมได้" });
      return;
    }
    setPreview(nextPreview);
  };

  const handleConfirmRefill = async () => {
    if (!preview?.batchItems.length) return;
    setSubmitting(true);
    try {
      if (preview.totalShortage > 0) throw new Error("ต้องจัดสรร Lot ให้ครบตามยอดที่ต้องเบิกก่อนยืนยัน");
      const byJob = new Map<string, RefillPreviewItem[]>();
      preview.items.forEach((entry) => {
        const job = entry.item.jobType || "";
        byJob.set(job, [...(byJob.get(job) || []), entry]);
      });
      for (const [jobType, entries] of byJob) {
        const workOrder = await apiClient.saveCountWorkOrder(jobType, entries.map((entry) => ({ itemId: entry.item.itemId, countedQty: entry.actual })));
        await apiClient.confirmCountWorkOrder(workOrder.id, entries.flatMap((entry) => entry.lots.map((lot) => ({ itemId: entry.item.itemId, inventoryId: Number(lot.inventoryId), qty: Number(lot.qty) }))));
      }
      const ids = preview.items.map((item) => item.item.itemId);
      await refreshFromServer(ids, ids);
      setPreview(null);
      setFeedback({
        type: "success",
        msg: preview.totalShortage > 0
          ? `เบิกเติมบางส่วนแล้ว สต็อกคลังกลางขาดอีก ${preview.totalShortage} หน่วย`
          : `เบิกเติม ${preview.items.length} รายการเรียบร้อยแล้ว`,
      });
    } catch (error: unknown) {
      const response = error as { response?: { data?: { error?: string } }; message?: string };
      setFeedback({ type: "error", msg: `เบิกเติมไม่สำเร็จ: ${response.response?.data?.error || response.message || "ไม่ทราบสาเหตุ"}` });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveForLater = async () => {
    const counted = reagents.filter((item) => item.actual !== "");
    if (!counted.length) return setFeedback({ type: "error", msg: "กรุณากรอกยอดนับอย่างน้อยหนึ่งรายการก่อนบันทึกใบงาน" });
    setSavingWorkOrder(true);
    try {
      const byJob = new Map<string, CountItem[]>();
      counted.forEach((item) => {
        const job = item.jobType || "";
        byJob.set(job, [...(byJob.get(job) || []), item]);
      });
      await Promise.all([...byJob.entries()].map(([jobType, items]) => apiClient.saveCountWorkOrder(jobType, items.map((item) => ({ itemId: item.itemId, countedQty: Number(item.actual) })) )));
      setFeedback({ type: "success", msg: "บันทึกใบงานแล้ว สามารถกลับมาเลือก Lot และยืนยันเบิกภายหลังได้" });
    } catch (error: unknown) {
      const response = error as { response?: { data?: { error?: string } }; message?: string };
      setFeedback({ type: "error", msg: `บันทึกใบงานไม่สำเร็จ: ${response.response?.data?.error || response.message || "ไม่ทราบสาเหตุ"}` });
    } finally { setSavingWorkOrder(false); }
  };

  if (authLoading || (user && loading)) {
    return <div className="flex h-96 flex-col items-center justify-center gap-4"><Loader2 className="animate-spin text-blue-600" size={48} /><p className="text-xs font-bold uppercase tracking-widest text-gray-500">กำลังโหลดรายการน้ำยา...</p></div>;
  }
  if (!user) return null;

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-[32px] font-medium leading-tight text-ink">นับสต็อกหน้างาน</h1>
        <p className="mt-1.5 text-[15px] text-gray-600">นับยอดจริง แล้วคำนวณการเบิกเติมจากเป้าหมายรายสัปดาห์</p>
      </div>

      {feedback && <div className={`flex items-center gap-3 rounded-2xl border p-4 ${feedback.type === "success" ? "border-ok/20 bg-ok-bg text-ok" : "border-crit/20 bg-crit-bg text-crit"}`}><>{feedback.type === "success" ? <CheckCircle size={20} /> : <AlertCircle size={20} />}</><p className="flex-1 text-sm font-medium">{feedback.msg}</p><button onClick={() => setFeedback(null)} className="text-xs font-medium underline">ปิด</button></div>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-line bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-medium text-ink">รอบนับ {new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date())}</h2>
            <p className="text-sm text-ink-muted">นับแล้ว {countedCount} / {reagents.length} รายการ</p>
          </div>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-ink transition-all" style={{ width: `${progress}%` }} /></div>

          <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_1fr_1fr_1fr] md:items-end">
            <div className="relative self-end"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={16} strokeWidth={1.5} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหารหัส ชื่อ หรือสแกน..." className="min-h-[38px] w-full rounded-[10px] border border-line bg-white py-[7px] pl-10 pr-10 text-sm outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10" />{search && <button onClick={() => setSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-muted" aria-label="ล้างคำค้น"><XCircle size={16} /></button>}</div>
            <MultiSelect label="ประเภทน้ำยา" options={categories.types} selected={filterType} onChange={setFilterType} />
            <MultiSelect label="ประเภทงาน" options={categories.jobs} selected={filterJob} onChange={setFilterJob} />
            <MultiSelect label="บริษัท (Vendor)" options={categories.vendors} selected={filterVendor} onChange={setFilterVendor} />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="text-[13px] font-medium text-gray-600">
                  <th className="rounded-l-[10px] bg-ground px-3.5 py-2.5">น้ำยา</th>
                  <th className="bg-ground px-3.5 py-2.5 text-right">คงเหลือคลังกลาง</th>
                  <th className="bg-ground px-3.5 py-2.5 text-right">เป้าหมาย</th>
                  <th className="bg-ground px-3.5 py-2.5">นับได้จริง</th>
                  <th className="rounded-r-[10px] bg-ground px-3.5 py-2.5">ส่วนต่าง</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const target = item.weeklyTarget || 0;
                  const diff = item.actual !== "" && item.actual < target ? target - item.actual : 0;
                  return (
                    <tr key={item.itemId} className="border-b border-line">
                      <td className="border-b border-line px-3.5 py-3"><p className="text-sm font-medium text-ink">{item.name}</p><p className="mt-0.5 text-xs text-ink-muted">{item.itemId}{item.reagentType ? ` · ${item.reagentType}` : ""}{item.jobType ? ` · ${item.jobType}` : ""}</p></td>
                      <td className="border-b border-line px-3.5 py-3 text-right text-sm text-ink">{item.quantity} <span className="text-xs text-ink-muted">{item.unit}</span></td>
                      <td className="border-b border-line px-3.5 py-3 text-right text-sm text-ink">{target} <span className="text-xs text-ink-muted">{item.unit}</span></td>
                      <td className="border-b border-line px-3.5 py-3"><input type="number" min="0" value={item.actual} onChange={(event) => handleInput(item.itemId, event.target.value)} aria-label={`นับได้จริง ${item.name}`} placeholder="ระบุจำนวน" className="min-h-[38px] w-28 rounded-[10px] border border-line bg-white px-3 text-center text-sm font-semibold text-ink outline-none focus:border-gray-400" /></td>
                      <td className="border-b border-line px-3.5 py-3">{item.refilled ? <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-3 py-1.5 text-xs font-medium text-ok"><CheckCircle size={14} />เติมสต็อกแล้ว</span> : diff > 0 ? <button onClick={() => openPreview([item])} disabled={submitting} className="inline-flex items-center gap-1.5 rounded-[10px] bg-ink px-3.5 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"><ShoppingCart size={15} />เบิกเติม {diff} {item.unit}</button> : item.actual !== "" ? <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-3 py-1.5 text-xs font-medium text-ok"><Smile size={14} />สต็อกหน้างานพอใช้</span> : <span className="text-xs text-ink-muted">รอนับรายการนี้</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filteredItems.length && !loading && <div className="py-16 text-center text-ink-muted"><ClipboardList className="mx-auto mb-3 opacity-40" size={48} strokeWidth={1.5} /><p className="text-sm">ไม่พบรายการที่ตรงกับเงื่อนไข</p></div>}
          </div>

          <div className="sticky bottom-4 z-10 mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-[#fafafa] px-4 py-3.5">
            <div className="flex gap-8">
              <div><p className="text-xs text-ink-muted">นับแล้ว</p><p className="text-2xl font-medium text-ink">{countedCount} / {reagents.length} <span className="text-sm text-ink-muted">รายการ</span></p></div>
              <div><p className="text-xs text-ink-muted">ต้องเบิกเติม</p><p className={`text-2xl font-medium ${refillItems.length ? "text-crit" : "text-ink"}`}>{refillItems.length} <span className="text-sm text-ink-muted">รายการ</span></p></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {countedCount > 0 && <button onClick={handleClearAll} className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink hover:bg-gray-50"><Trash2 size={15} />ล้างยอดนับค้าง</button>}
              {countedCount > 0 && <button onClick={handleSaveForLater} disabled={savingWorkOrder} className="rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-50">{savingWorkOrder ? "กำลังบันทึก..." : "บันทึกใบงานไว้ก่อน"}</button>}
              <button onClick={() => openPreview(refillItems)} disabled={submitting || refillItems.length === 0} className="inline-flex items-center gap-2 rounded-[10px] bg-ink px-5 py-3 text-sm font-medium text-white hover:bg-black disabled:opacity-40"><ArrowRightLeft size={15} />ดูสรุปก่อนเบิก</button>
            </div>
          </div>
        </section>

        <aside className="rounded-2xl border border-line bg-white p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-medium text-ink">ใบงานนับสต็อกของฉัน</h2>
            <Link href="/count/work-orders" className="text-sm font-medium text-ink underline underline-offset-4">ดูทั้งหมด</Link>
          </div>
          <p className="mt-1 text-[13px] text-gray-600">เปิดใบงานเพื่อแก้ยอด เลือก Lot หรือยืนยันเบิก</p>
          <div className="mt-4 space-y-3">
            {workOrders.length === 0 && <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-xs text-ink-muted">ยังไม่มีใบงาน</p>}
            {workOrders.slice(0, 5).map((order) => {
              const state = WORK_ORDER_STATE[order.status];
              return (
                <Link key={order.id} href={`/count/work-orders/${order.id}`} className="block rounded-xl border border-line p-3.5 hover:border-gray-400">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-ink">ใบงาน: {order.jobType || "ทุกหน่วยงาน"}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-[3px] text-xs font-medium ${state.className}`}>{state.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{order.itemCount} รายการ · อัปเดต {formatShortDate(order.updatedAt)}</p>
                </Link>
              );
            })}
          </div>
        </aside>
      </div>

      <Modal isOpen={Boolean(preview)} onClose={() => !submitting && setPreview(null)} title="สรุปรายการก่อนยืนยันเบิก" maxWidth="max-w-4xl">
        {preview && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><p className="text-[10px] font-black uppercase text-blue-400">รายการที่จะเติม</p><p className="text-2xl font-black text-blue-800">{preview.items.length}</p></div><div className="rounded-2xl border border-gray-100 bg-gray-50 p-4"><p className="text-[10px] font-black uppercase text-gray-400">ต้องการรวม</p><p className="text-2xl font-black text-gray-800">{preview.totalNeeded}</p></div><div className="rounded-2xl border border-green-100 bg-green-50 p-4"><p className="text-[10px] font-black uppercase text-green-500">จะเบิกได้</p><p className="text-2xl font-black text-green-700">{preview.totalDispensed}</p></div></div>{preview.totalShortage > 0 && <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800"><AlertTriangle size={20} /><p className="text-sm font-bold">สต็อกคลังกลางไม่พอ ขาดอีก {preview.totalShortage} หน่วย ระบบจะเบิกเท่าที่มี</p></div>}<div className="max-h-[46vh] space-y-3 overflow-y-auto">{preview.items.map((entry) => <div key={entry.item.itemId} className="rounded-2xl border border-gray-100 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-gray-900">{entry.item.name}</p><p className="text-[11px] font-bold text-gray-400">นับได้ {entry.actual} / เป้าหมาย {entry.item.weeklyTarget} {entry.item.unit}</p></div><p className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-black text-blue-800">เบิก {entry.dispensed} {entry.item.unit}</p></div><div className="mt-3 space-y-2">{entry.lots.map((lot) => <div key={lot.inventoryId} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><p className="text-xs font-bold text-gray-600">Lot {lot.lotNo} · EXP {formatShortDate(lot.expDate)} · รับ {formatShortDate(lot.receivedOn)}</p><p className="text-sm font-black text-gray-900">{lot.qty} {lot.unit}</p></div>)}</div></div>)}</div><div className="flex flex-col gap-3 pt-2 sm:flex-row"><button onClick={() => setPreview(null)} disabled={submitting} className="rounded-2xl border border-gray-200 px-6 py-4 text-sm font-black text-gray-600 disabled:opacity-50">ยกเลิก</button><button onClick={handleConfirmRefill} disabled={submitting || !preview.batchItems.length} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gray-900 px-6 py-4 text-sm font-black text-white disabled:opacity-50">{submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}ยืนยันเบิก {preview.totalDispensed} รายการ</button></div></div>}
      </Modal>

    </div>
  );
}
