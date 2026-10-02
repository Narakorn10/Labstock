"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RefreshCw, Search } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import {
  APP_EVENT_ACTION_LABELS,
  APP_EVENT_OUTCOME_LABELS,
  type AppEventRow,
  type RepeatedFailure,
} from "@/lib/app-events-types";

const OUTCOME_STYLES: Record<string, string> = {
  success: "bg-green-50 text-green-700 border-green-100",
  rejected: "bg-amber-50 text-amber-800 border-amber-100",
  error: "bg-red-50 text-red-700 border-red-100",
};

const DETAIL_LABELS: Record<string, string> = {
  workOrderId: "ใบงาน", jobType: "หน่วยงาน", count: "จำนวนรายการ", mode: "โหมด", attemptedUser: "ชื่อที่กรอก",
  itemId: "รหัส", lotNo: "Lot", inventoryId: "รหัสรอบรับเข้า", qty: "จำนวน", countedQty: "นับได้", poNumber: "เลขที่ PO",
};

const formatTime = (value: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));

const actionLabel = (action: string) => APP_EVENT_ACTION_LABELS[action] || action;

function DetailView({ event }: { event: AppEventRow }) {
  const { items, itemsTotal, ...rest } = event.details as { items?: Array<Record<string, unknown>>; itemsTotal?: number } & Record<string, unknown>;
  const summary = Object.entries(rest);
  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-gray-50 p-4 text-xs text-gray-700">
      <div className="grid gap-1 sm:grid-cols-2">
        <p><span className="font-black">Route:</span> {event.method} {event.route}</p>
        <p><span className="font-black">Request ID:</span> {event.requestId || "-"}</p>
        <p><span className="font-black">ใช้เวลา:</span> {event.durationMs ?? "-"} ms</p>
        {summary.map(([key, value]) => <p key={key}><span className="font-black">{DETAIL_LABELS[key] || key}:</span> {String(value)}</p>)}
      </div>
      {Array.isArray(items) && items.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1 font-black">รายการที่ส่งมา ({itemsTotal ?? items.length}{itemsTotal && itemsTotal > items.length ? `, แสดง ${items.length}` : ""})</p>
          <table className="w-full text-left">
            <thead><tr className="text-gray-400">{Object.keys(items[0]).map((key) => <th key={key} className="pr-4 font-bold">{DETAIL_LABELS[key] || key}</th>)}</tr></thead>
            <tbody>{items.map((item, index) => <tr key={index} className="border-t border-gray-200">{Object.keys(items[0]).map((key) => <td key={key} className="py-1 pr-4">{String(item[key] ?? "")}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ActivityPage() {
  const [events, setEvents] = useState<AppEventRow[]>([]);
  const [repeated, setRepeated] = useState<RepeatedFailure[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiClient.getAppEvents({ username: username.trim(), action, outcome, startDate, endDate });
      setEvents(data.items);
      setRepeated(data.repeated);
      setNextCursor(data.nextCursor);
      setExpanded(null);
    } catch (err: unknown) {
      const response = err as { response?: { data?: { error?: string } }; message?: string };
      setError(response.response?.data?.error || response.message || "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [username, action, outcome, startDate, endDate]);

  useEffect(() => {
    const timer = setTimeout(load, 400);
    return () => clearTimeout(timer);
  }, [load]);

  const loadMore = async () => {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const data = await apiClient.getAppEvents({ username: username.trim(), action, outcome, startDate, endDate, before: nextCursor });
      setEvents((previous) => [...previous, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (err: unknown) {
      const response = err as { response?: { data?: { error?: string } }; message?: string };
      setError(response.response?.data?.error || response.message || "โหลดเพิ่มไม่สำเร็จ");
    } finally {
      setLoadingMore(false);
    }
  };

  const focusRepeated = (entry: RepeatedFailure) => {
    setAction(entry.action);
    setOutcome("failed");
    setUsername("");
  };

  const inputClass = "w-full rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-blue-500/20";

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-[32px] leading-tight font-medium tracking-tight text-ink">กิจกรรมผู้ใช้</h1>
          <p className="mt-1 text-sm text-ink-muted">ดูว่าใครทำอะไร และทำไมไม่สำเร็จ (เก็บย้อนหลัง 90 วัน)</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 self-start rounded-xl bg-gray-100 px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />รีเฟรช
        </button>
      </div>

      {repeated.length > 0 && (
        <section className="space-y-3 rounded-[20px] border border-amber-100 bg-amber-50 p-5">
          <p className="flex items-center gap-2 text-sm font-black text-amber-900"><AlertTriangle size={18} />ปัญหาที่เกิดซ้ำใน 7 วันล่าสุด (หลายคนเจอเหมือนกัน อาจเป็นบั๊ก)</p>
          <div className="grid gap-2 md:grid-cols-2">
            {repeated.map((entry) => (
              <button key={`${entry.action}|${entry.message}`} onClick={() => focusRepeated(entry)} className="rounded-2xl border border-amber-100 bg-white p-4 text-left hover:border-amber-300">
                <p className="text-xs font-black text-gray-500">{actionLabel(entry.action)}</p>
                <p className="mt-1 text-sm font-bold text-gray-900">{entry.message || "(ไม่มีข้อความ)"}</p>
                <p className="mt-2 text-[11px] font-bold text-amber-800">{entry.occurrences} ครั้ง · {entry.users} คน · ล่าสุด {formatTime(entry.lastSeen)}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="relative md:col-span-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="รหัสผู้ใช้ เช่น 6928" className={`${inputClass} pl-10`} />
        </div>
        <select value={action} onChange={(event) => setAction(event.target.value)} className={inputClass}>
          <option value="">ทุกการกระทำ</option>
          {Object.entries(APP_EVENT_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={outcome} onChange={(event) => setOutcome(event.target.value)} className={inputClass}>
          <option value="">ทุกผลลัพธ์</option>
          <option value="failed">ล้มเหลวทั้งหมด</option>
          <option value="rejected">ถูกปฏิเสธ</option>
          <option value="error">ระบบผิดพลาด</option>
          <option value="success">สำเร็จ</option>
        </select>
        <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} aria-label="ตั้งแต่วันที่" />
        <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={inputClass} aria-label="ถึงวันที่" />
      </div>

      {error && <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      {loading && events.length === 0 ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-600" size={40} /></div>
      ) : events.length === 0 ? (
        <div className="rounded-[20px] border border-gray-100 bg-white py-16 text-center font-bold text-gray-400">ไม่พบกิจกรรมตามเงื่อนไข</div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <article key={event.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setExpanded(expanded === event.id ? null : event.id)}>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-black ${OUTCOME_STYLES[event.outcome]}`}>{APP_EVENT_OUTCOME_LABELS[event.outcome]}{event.status ? ` ${event.status}` : ""}</span>
                    <span className="text-sm font-black text-gray-900">{actionLabel(event.action)}</span>
                  </div>
                  <p className="text-xs font-bold text-gray-500">{event.username || "ไม่ทราบผู้ใช้"}{event.role ? ` (${event.role})` : ""} · {formatTime(event.createdAt)}</p>
                  {event.message && <p className="text-sm font-bold text-gray-800">{event.message}</p>}
                </div>
                {expanded === event.id ? <ChevronUp size={18} className="shrink-0 text-gray-400" /> : <ChevronDown size={18} className="shrink-0 text-gray-400" />}
              </button>
              {expanded === event.id && <DetailView event={event} />}
            </article>
          ))}
          {nextCursor !== null && (
            <button onClick={loadMore} disabled={loadingMore} className="w-full rounded-2xl border border-gray-200 bg-white py-4 text-sm font-black text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
