"use client";

import { useEffect, useMemo, useState } from "react";
import { buildAddItemsBody, canSubmitLines, type NewLine } from "@/lib/po-add-items-client";

// A manager adds reagent lines to an order that is still waiting for their review. Add only: existing lines are not
// shown for editing here. The server checks everything again (same company, active reagent of this room, not already
// on the order, reason for a manual quantity, order still in review) and answers with the reason when it refuses.

type CatalogReagent = { itemId: string; name: string; unit: string; quantity: number; minThreshold: number; vendor?: string; reagentType?: string };

type Props = {
  poId: number;
  vendor: string;
  existingItemIds: string[];
  getAuthHeaders: () => Record<string, string>;
  /** Called with the updated order (as returned by the API) after the lines were added. */
  onAdded: (order: unknown) => void | Promise<void>;
  onClose: () => void;
};

export function PoAddItemsDialog({ poId, vendor, existingItemIds, getAuthHeaders, onAdded, onClose }: Props) {
  const [catalog, setCatalog] = useState<CatalogReagent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<NewLine[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard", { headers: getAuthHeaders() });
        if (!active) return;
        if (res.ok) setCatalog((await res.json()) as CatalogReagent[]);
        else setError("โหลดรายชื่อน้ำยาไม่สำเร็จ กรุณาปิดแล้วเปิดใหม่");
      } catch {
        if (active) setError("โหลดรายชื่อน้ำยาไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
    // The headers come from localStorage on every call; the list is loaded once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOrder = useMemo(() => new Set(existingItemIds), [existingItemIds]);
  const chosen = useMemo(() => new Set(lines.map((line) => line.item_id)), [lines]);

  const choices = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return catalog
      .filter((reagent) => reagent.vendor === vendor)
      .filter((reagent) => !term || reagent.name.toLocaleLowerCase().includes(term) || reagent.itemId.toLocaleLowerCase().includes(term))
      .sort((left, right) => left.name.localeCompare(right.name, "th"))
      .slice(0, 50);
  }, [catalog, search, vendor]);

  const addLine = (reagent: CatalogReagent) => {
    if (onOrder.has(reagent.itemId) || chosen.has(reagent.itemId)) return;
    setLines((current) => [...current, { item_id: reagent.itemId, item_name: reagent.name, unit: reagent.unit, quantity: "", reason: "" }]);
  };
  const changeLine = (itemId: string, change: Partial<NewLine>) =>
    setLines((current) => current.map((line) => (line.item_id === itemId ? { ...line, ...change } : line)));
  const removeLine = (itemId: string) => setLines((current) => current.filter((line) => line.item_id !== itemId));

  const canSubmit = canSubmitLines(lines);

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(buildAddItemsBody(lines)),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "เพิ่มรายการไม่สำเร็จ");
        return;
      }
      await onAdded(data);
      onClose();
    } catch {
      setError("เพิ่มรายการไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 no-print" role="dialog" aria-modal="true" aria-labelledby="po-add-items-title">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 p-5">
          <h2 id="po-add-items-title" className="text-lg font-bold text-slate-900">เพิ่มรายการน้ำยา</h2>
          <p className="mt-1 text-sm text-slate-600">เพิ่มได้เฉพาะน้ำยาของบริษัท {vendor} ขณะที่ใบนี้ยังรอตรวจ รายการเดิมไม่ถูกแก้ไขหรือลบ และบริษัทยังไม่เห็นใบนี้จนกว่าจะกดส่ง</p>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div>
            <label htmlFor="po-add-search" className="block text-sm font-medium text-slate-700">ค้นหาน้ำยา</label>
            <input
              id="po-add-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ชื่อหรือรหัสน้ำยา"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm"
            />
            <ul className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {loading && <li className="p-3 text-sm text-slate-500">กำลังโหลดรายชื่อน้ำยา…</li>}
              {!loading && choices.length === 0 && <li className="p-3 text-sm text-slate-500">ไม่พบน้ำยาของบริษัทนี้ที่ตรงกับคำค้น</li>}
              {choices.map((reagent) => {
                const taken = onOrder.has(reagent.itemId) || chosen.has(reagent.itemId);
                return (
                  <li key={reagent.itemId}>
                    <button
                      type="button"
                      disabled={taken}
                      onClick={() => addLine(reagent)}
                      className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>
                        <span className="font-medium text-slate-900">{reagent.name}</span>
                        <span className="ml-2 text-xs text-slate-500">{reagent.itemId}</span>
                        {onOrder.has(reagent.itemId) && <span className="ml-2 text-xs font-semibold text-slate-500">(อยู่ในใบนี้แล้ว)</span>}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">คงเหลือ {reagent.quantity} {reagent.unit}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {lines.length > 0 && (
            <ul className="space-y-3">
              {lines.map((line) => (
                <li key={line.item_id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{line.item_name} <span className="text-xs font-normal text-slate-500">({line.unit})</span></p>
                    <button type="button" onClick={() => removeLine(line.item_id)} className="text-xs font-semibold text-red-700 hover:underline">เอาออก</button>
                  </div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-[8rem_1fr]">
                    <div>
                      <label htmlFor={`po-add-qty-${line.item_id}`} className="block text-xs font-medium text-slate-600">จำนวน ({line.unit})</label>
                      <input
                        id={`po-add-qty-${line.item_id}`}
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={(event) => changeLine(line.item_id, { quantity: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor={`po-add-reason-${line.item_id}`} className="block text-xs font-medium text-slate-600">เหตุผลที่เพิ่ม (บังคับ)</label>
                      <input
                        id={`po-add-reason-${line.item_id}`}
                        value={line.reason}
                        maxLength={500}
                        onChange={(event) => changeLine(line.item_id, { reason: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 p-4">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">ยกเลิก</button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit || submitting}
            className="rounded-lg bg-ink px-4 py-2 font-semibold text-white hover:bg-black disabled:opacity-60"
          >
            {submitting ? "กำลังเพิ่ม…" : `เพิ่ม ${lines.length || ""} รายการเข้าใบนี้`}
          </button>
        </div>
      </div>
    </div>
  );
}
