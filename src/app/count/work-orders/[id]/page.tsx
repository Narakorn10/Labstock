"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import CountRefillResult, { problemsFromError, problemsFromFailures, type RefillOutcome } from "@/components/count-refill-result";
import { apiClient, type Lot } from "@/lib/api-client";

type Allocation = { inventoryId: number; qty: number; lotNo?: string | null; createdAt?: string };
type Item = { itemId: string; name: string; unit: string; weeklyTarget: number; countedQty: number; requiredQty: number; revision: number; isActive?: boolean; allocations?: Allocation[] };
type Order = { id: number; ownerUsername: string; jobType: string; status: "OPEN" | "CONFIRMED" | "CANCELLED"; items: Item[] };
type Plan = { allocations: Array<{ itemId: string; inventoryId: number; qty: number }>; available: number; complete: boolean };

const isDispensed = (item: Item) => (item.allocations?.length || 0) > 0;
const isPending = (item: Item) => item.isActive !== false && !isDispensed(item) && Number(item.requiredQty) > 0;
const formatDateTime = (value?: string) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short" }).format(date) : "-";
};

export default function WorkOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id); const [order, setOrder] = useState<Order | null>(null); const [lots, setLots] = useState<Lot[]>([]); const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<RefillOutcome[] | null>(null);
  const reload = useCallback(() => Promise.all([apiClient.getCountWorkOrder(id), apiClient.getCountWorkOrderLots(id)]).then(([o, l]) => { setOrder(o); setLots(l); }), [id]);
  useEffect(() => { reload().catch((e) => setMessage(e.response?.data?.error || "โหลดใบงานไม่สำเร็จ")); }, [reload]);

  // Plan lots FEFO (the API returns them in FEFO order) for each item still waiting; only fully covered items are sent.
  const plans = useMemo(() => new Map<string, Plan>((order?.items || []).filter(isPending).map((item) => {
    let remaining = Number(item.requiredQty);
    const allocations = (lots as Array<Lot & { itemId?: string }>).filter((lot) => lot.itemId?.toLowerCase() === item.itemId.toLowerCase()).flatMap((lot) => {
      const qty = Math.min(remaining, Number(lot.qty)); remaining -= qty;
      return qty > 0 ? [{ itemId: item.itemId, inventoryId: lot.inventoryId, qty }] : [];
    });
    const available = allocations.reduce((sum, allocation) => sum + allocation.qty, 0);
    return [item.itemId, { allocations, available, complete: available >= Number(item.requiredQty) }];
  })), [lots, order]);

  if (!order) return <p className="p-6">{message || "กำลังโหลด..."}</p>;
  const editable = order.status === "OPEN";
  const openItems = order.items.filter((item) => !isDispensed(item));
  const dispensedItems = order.items.filter(isDispensed);
  const pendingItems = order.items.filter(isPending);
  const completeCount = pendingItems.filter((item) => plans.get(item.itemId)?.complete).length;

  const handleConfirm = async () => {
    setBusy(true);
    const outcome: RefillOutcome = { workOrderId: id, dispensed: [], problems: [] };
    const complete = pendingItems.filter((item) => plans.get(item.itemId)?.complete);
    pendingItems.filter((item) => !plans.get(item.itemId)?.complete).forEach((item) => {
      const available = plans.get(item.itemId)?.available || 0;
      outcome.problems.push({ itemId: item.itemId, name: item.name, kind: available ? "PARTIAL_STOCK" : "NO_STOCK", requiredQty: Number(item.requiredQty), available });
    });
    // With nothing waiting (e.g. only deactivated items left) an empty confirm closes the order.
    if (complete.length || !pendingItems.length) {
      try {
        const res = await apiClient.confirmCountWorkOrder(id, complete.flatMap((item) => plans.get(item.itemId)!.allocations));
        outcome.dispensed = res.dispensed;
        outcome.problems.push(...problemsFromFailures(res.failed));
        setMessage(res.message);
      } catch (error: unknown) {
        outcome.problems.push(...problemsFromError(error));
      }
    }
    setResult([outcome]);
    await reload().catch(() => undefined);
    setBusy(false);
  };

  const renderStatus = (item: Item) => {
    if (item.isActive === false) return <b className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">ปิดใช้งานแล้ว · ไม่ต้องเบิก</b>;
    if (Number(item.requiredQty) <= 0) return <b className="text-sm text-gray-500">ไม่ต้องเบิก</b>;
    const plan = plans.get(item.itemId);
    const stock = !editable ? null : plan?.complete
      ? <span className="rounded-full bg-ok-bg px-2.5 py-1 text-xs font-medium text-ok">Lot ครบ</span>
      : <span className="rounded-full bg-warn-bg px-2.5 py-1 text-xs font-medium text-warn">{plan?.available ? `คลังมี ${plan.available} จาก ${item.requiredQty}` : "ไม่มีของในคลัง"}</span>;
    return <span className="flex items-center gap-2"><b className="text-blue-700">ต้องเบิก {item.requiredQty} {item.unit}</b>{stock}</span>;
  };

  return <section className="mx-auto max-w-5xl space-y-5">
    <div><h1 className="text-2xl font-black">ใบงาน: {order.jobType || "ทุกหน่วยงาน"}</h1><p className="text-sm text-gray-500">สถานะ {order.status} · Lot ที่แสดงเป็นยอดสดจากคลังกลาง</p></div>
    {message && <p className="rounded-xl bg-amber-50 p-3 font-bold text-amber-800">{message}</p>}
    <div className="space-y-3">{openItems.map((item) => <article key={item.itemId} className="rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black">{item.name}</p><p className="text-xs text-gray-500">เป้าหมาย {item.weeklyTarget} {item.unit} · revision {item.revision}</p></div><label className="font-bold">นับได้ <input disabled={!editable || item.isActive === false} type="number" min="0" value={item.countedQty} onChange={(e) => setOrder({ ...order, items: order.items.map((x) => x.itemId === item.itemId ? { ...x, countedQty: Number(e.target.value), requiredQty: Math.max(Number(x.weeklyTarget) - Number(e.target.value), 0) } : x) })} className="ml-2 w-20 rounded border p-2 text-right" /></label>{renderStatus(item)}</div></article>)}</div>
    {editable && <div className="flex flex-wrap gap-3">
      <button disabled={busy} onClick={() => apiClient.updateCountWorkOrder(id, openItems.filter((x) => x.isActive !== false).map((x) => ({ itemId: x.itemId, countedQty: Number(x.countedQty) }))).then(() => { setMessage("บันทึก revision แล้ว"); reload(); }).catch((e) => setMessage(e.response?.data?.error || "บันทึกไม่สำเร็จ"))} className="rounded-xl border px-5 py-3 font-bold disabled:opacity-50">บันทึกยอดแก้ไข</button>
      <button disabled={busy} onClick={handleConfirm} className="rounded-xl bg-ink px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? "กำลังเบิก..." : pendingItems.length ? `ยืนยันเบิก ${completeCount} รายการที่ครบ (FEFO)` : "ปิดใบงาน"}</button>
      <button disabled={busy} onClick={() => reload().then(() => setMessage("โหลด Lot ล่าสุดแล้ว")).catch((e) => setMessage(e.response?.data?.error || "โหลดใบงานไม่สำเร็จ"))} className="rounded-xl border px-5 py-3 font-bold disabled:opacity-50">โหลด Lot ล่าสุด</button>
      <button disabled={busy} onClick={() => apiClient.cancelCountWorkOrder(id).then(() => { setMessage("ยกเลิกใบงานแล้ว"); reload(); })} className="rounded-xl border border-red-200 px-5 py-3 font-bold text-red-700 disabled:opacity-50">ยกเลิกใบงาน</button>
    </div>}
    {dispensedItems.length > 0 && <details className="rounded-2xl border bg-white p-4">
      <summary className="cursor-pointer font-black">เบิกแล้ว ({dispensedItems.length} รายการ)</summary>
      <div className="mt-3 space-y-2">{dispensedItems.map((item) => <div key={item.itemId} className="rounded-xl bg-gray-50 p-3"><p className="font-bold">{item.name}</p>{item.allocations!.map((allocation) => <p key={allocation.inventoryId} className="text-xs text-gray-600">Lot {allocation.lotNo || allocation.inventoryId} · {allocation.qty} {item.unit} · {formatDateTime(allocation.createdAt)}</p>)}</div>)}</div>
    </details>}
    <CountRefillResult outcomes={result} onClose={() => setResult(null)} showOrderLinks={false} />
  </section>;
}
