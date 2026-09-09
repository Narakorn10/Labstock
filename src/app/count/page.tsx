"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { apiClient, type BatchItem, type Reagent } from "@/lib/api-client";

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
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [preview, setPreview] = useState<RefillPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingWorkOrder, setSavingWorkOrder] = useState(false);

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

  const categories = useMemo(() => ({
    types: Array.from(new Set(reagents.map((item) => item.reagentType).filter(Boolean))).sort(),
    jobs: Array.from(new Set(reagents.map((item) => item.jobType).filter(Boolean))).sort(),
  }), [reagents]);

  const filteredItems = useMemo(() => reagents.filter((item) => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const searchText = `${item.itemId} ${item.name} ${item.qrCode || ""}`.toLowerCase();
    return (terms.length === 0 || terms.every((term) => searchText.includes(term)))
      && (filterType.includes("ALL") || filterType.includes(item.reagentType))
      && (filterJob.includes("ALL") || filterJob.includes(item.jobType));
  }), [filterJob, filterType, reagents, search]);

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
    <div className="mx-auto max-w-4xl space-y-6 pb-40">
      <section className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-r from-blue-600 to-indigo-600 p-8 text-white shadow-xl">
        <div className="relative z-10">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3"><div className="rounded-xl bg-white/20 p-2"><ClipboardList size={24} /></div><h1 className="text-2xl font-black">นับสต็อกหน้างาน</h1></div>
            {countedCount > 0 && <div className="flex gap-2"><button onClick={handleSaveForLater} disabled={savingWorkOrder} className="rounded-xl border border-white/20 bg-white/15 px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-white/25 disabled:opacity-50">{savingWorkOrder ? "กำลังบันทึก..." : "บันทึกใบงานไว้ก่อน"}</button><button onClick={handleClearAll} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-white/20"><Trash2 size={14} />ล้างยอดนับค้าง</button></div>}
          </div>
          <p className="text-sm font-bold text-blue-100">นับยอดจริง แล้วคำนวณการเบิกเติมจากเป้าหมายรายสัปดาห์</p>
          <div className="mt-6"><div className="mb-2 flex justify-between text-[10px] font-black uppercase tracking-widest text-blue-100"><span>ความคืบหน้าการนับรวม</span><span>{countedCount} / {reagents.length} รายการ</span></div><div className="h-2.5 overflow-hidden rounded-full bg-blue-900/30"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${progress}%` }} /></div></div>
        </div>
      </section>

      <section className="space-y-6 rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm">
        <div className="group relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="พิมพ์รหัส ชื่อ หรือสแกนเพื่อค้นหา..." className="w-full rounded-2xl border border-gray-100 bg-gray-50 py-4 pl-11 pr-10 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" />{search && <button onClick={() => setSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"><XCircle size={18} /></button>}</div>
        <div className="grid gap-6 md:grid-cols-2"><MultiSelect label="ประเภทน้ำยา" options={categories.types} selected={filterType} onChange={setFilterType} /><MultiSelect label="ประเภทงาน" options={categories.jobs} selected={filterJob} onChange={setFilterJob} /></div>
      </section>

      {feedback && <div className={`flex items-center gap-3 rounded-2xl border p-4 ${feedback.type === "success" ? "border-green-100 bg-green-50 text-green-700" : "border-red-100 bg-red-50 text-red-700"}`}><>{feedback.type === "success" ? <CheckCircle size={20} /> : <AlertCircle size={20} />}</><p className="flex-1 text-sm font-bold">{feedback.msg}</p><button onClick={() => setFeedback(null)} className="text-xs font-black">ปิด</button></div>}

      <div className="space-y-4">
        {filteredItems.map((item) => {
          const target = item.weeklyTarget || 0;
          const diff = item.actual !== "" && item.actual < target ? target - item.actual : 0;
          return <article key={item.itemId} className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-3 border-b border-gray-50 pb-4"><div className="min-w-0"><h3 className="mb-1 truncate text-base font-black text-gray-800">{item.name}</h3><div className="flex flex-wrap gap-2"><span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold text-gray-400">ID: {item.itemId}</span><span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-500">{item.reagentType}</span><span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-500">{item.jobType}</span></div></div><div className="flex shrink-0 gap-2"><div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-center"><p className="text-[8px] font-black uppercase text-blue-400">คงเหลือคลังกลาง</p><p className="text-sm font-black text-blue-700">{item.quantity} <span className="text-[10px]">{item.unit}</span></p></div><div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-center"><p className="text-[8px] font-black uppercase text-gray-400">เป้าหมาย</p><p className="text-sm font-black text-gray-700">{target} <span className="text-[10px]">{item.unit}</span></p></div></div></div>
            <div className="flex flex-col items-center gap-4 sm:flex-row"><div className="relative w-full sm:flex-1"><label className="absolute -top-2 left-4 bg-white px-1 text-[9px] font-black uppercase tracking-widest text-blue-600">นับได้จริง</label><input type="number" min="0" value={item.actual} onChange={(event) => handleInput(item.itemId, event.target.value)} placeholder="ระบุจำนวน" className="w-full rounded-2xl border border-blue-200 px-5 py-4 text-center text-xl font-black text-blue-900 outline-none focus:bg-blue-50" /></div><div className="flex w-full sm:flex-1">{item.refilled ? <div className="flex w-full items-center justify-center gap-2 rounded-2xl border border-green-100 bg-green-50 py-4 text-sm font-black text-green-600"><CheckCircle size={18} />เติมสต็อกแล้ว</div> : diff > 0 ? <button onClick={() => openPreview([item])} disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-sm font-black text-white shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-50"><ShoppingCart size={18} />กดเบิกเติม {diff} {item.unit}</button> : item.actual !== "" ? <div className="flex w-full items-center justify-center gap-2 rounded-2xl border border-green-100 bg-green-50 py-4 text-sm font-black text-green-600"><Smile size={18} />สต็อกหน้างานพอใช้</div> : <div className="w-full rounded-2xl border border-gray-100 bg-gray-50 py-4 text-center text-sm font-bold text-gray-400">รอนับรายการนี้</div>}</div></div>
          </article>;
        })}
        {!filteredItems.length && !loading && <div className="rounded-[2.5rem] border border-gray-100 bg-white py-20 text-center text-gray-400"><ClipboardList className="mx-auto mb-4 opacity-30" size={64} /><p className="font-bold">ไม่พบรายการที่ตรงกับเงื่อนไข</p></div>}
      </div>

      <Modal isOpen={Boolean(preview)} onClose={() => !submitting && setPreview(null)} title="สรุปรายการก่อนยืนยันเบิก" maxWidth="max-w-4xl">
        {preview && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><p className="text-[10px] font-black uppercase text-blue-400">รายการที่จะเติม</p><p className="text-2xl font-black text-blue-800">{preview.items.length}</p></div><div className="rounded-2xl border border-gray-100 bg-gray-50 p-4"><p className="text-[10px] font-black uppercase text-gray-400">ต้องการรวม</p><p className="text-2xl font-black text-gray-800">{preview.totalNeeded}</p></div><div className="rounded-2xl border border-green-100 bg-green-50 p-4"><p className="text-[10px] font-black uppercase text-green-500">จะเบิกได้</p><p className="text-2xl font-black text-green-700">{preview.totalDispensed}</p></div></div>{preview.totalShortage > 0 && <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800"><AlertTriangle size={20} /><p className="text-sm font-bold">สต็อกคลังกลางไม่พอ ขาดอีก {preview.totalShortage} หน่วย ระบบจะเบิกเท่าที่มี</p></div>}<div className="max-h-[46vh] space-y-3 overflow-y-auto">{preview.items.map((entry) => <div key={entry.item.itemId} className="rounded-2xl border border-gray-100 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-gray-900">{entry.item.name}</p><p className="text-[11px] font-bold text-gray-400">นับได้ {entry.actual} / เป้าหมาย {entry.item.weeklyTarget} {entry.item.unit}</p></div><p className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-black text-blue-800">เบิก {entry.dispensed} {entry.item.unit}</p></div><div className="mt-3 space-y-2">{entry.lots.map((lot) => <div key={lot.inventoryId} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"><p className="text-xs font-bold text-gray-600">Lot {lot.lotNo} · EXP {formatShortDate(lot.expDate)} · รับ {formatShortDate(lot.receivedOn)}</p><p className="text-sm font-black text-gray-900">{lot.qty} {lot.unit}</p></div>)}</div></div>)}</div><div className="flex flex-col gap-3 pt-2 sm:flex-row"><button onClick={() => setPreview(null)} disabled={submitting} className="rounded-2xl border border-gray-200 px-6 py-4 text-sm font-black text-gray-600 disabled:opacity-50">ยกเลิก</button><button onClick={handleConfirmRefill} disabled={submitting || !preview.batchItems.length} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gray-900 px-6 py-4 text-sm font-black text-white disabled:opacity-50">{submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}ยืนยันเบิก {preview.totalDispensed} รายการ</button></div></div>}
      </Modal>

      {refillItems.length > 0 && <div className="fixed bottom-8 left-0 right-0 z-40 px-4"><div className="mx-auto max-w-md"><button onClick={() => openPreview(refillItems)} disabled={submitting} className="flex w-full items-center justify-between gap-4 rounded-[2.5rem] border-2 border-white/10 bg-gray-900 p-6 text-white shadow-2xl hover:bg-gray-800 disabled:opacity-50"><div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600"><ArrowRightLeft size={24} /></div><div className="text-left"><p className="text-[10px] font-black uppercase tracking-widest text-gray-400">ในตะกร้าเบิกเติม</p><p className="text-xl font-black">{refillItems.length} รายการ</p></div></div><span className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black">ดูสรุปก่อนเบิก</span></button></div></div>}
    </div>
  );
}
