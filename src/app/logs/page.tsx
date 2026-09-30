'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { Download, Loader2, RefreshCw, Calendar } from 'lucide-react';

interface LogEntry {
  id: number;
  timestamp: string;
  itemId: string;
  name: string;
  lotNo: string;
  action: string;
  qty: number;
  user: string;
}

const LOG_ACTION_CHIPS = [
  { label: 'ทั้งหมด', value: '' },
  { label: 'รับเข้า', value: 'รับเข้าสต๊อกหลัก' },
  { label: 'เบิกไปหน้างาน', value: 'เบิกไปหน้างาน' },
  { label: 'ปรับยอด', value: 'ปรับปรุงยอดสต๊อก (Reconciliation)' },
];

function sortLogsNewestFirst(entries: LogEntry[]) {
  return entries.toSorted((a, b) => {
    const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    return timeDiff || b.id - a.id;
  });
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiClient.getLogs(500, {
        search: searchTerm,
        action: actionFilter,
        startDate,
        endDate
      });
      setLogs(sortLogsNewestFirst(data));
    } catch (err: unknown) {
      console.error(err);
      const error = err as { response?: { data?: { error?: string } }, message?: string };
      setLoadError(error.response?.data?.error || error.message || 'Unable to load transaction logs');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, actionFilter, startDate, endDate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLogs();
    }, 500); // Debounce search
    return () => clearTimeout(timer);
  }, [fetchLogs]);

  const exportCSV = () => {
    if (logs.length === 0) return;
    const headers = ['วันเวลา', 'Item ID', 'ชื่อน้ำยา', 'Lot No.', 'การทำรายการ', 'จำนวน', 'ผู้ทำรายการ'];
    const csvContent = [
      headers.join(','),
      ...logs.map(log => [
        `"${log.timestamp}"`,
        `"${log.itemId}"`,
        `"${log.name}"`,
        `"${log.lotNo}"`,
        `"${log.action}"`,
        log.qty,
        `"${log.user}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `LabStock_Logs_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const fieldClass = 'min-h-[38px] rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10';
  const headClass = 'bg-ground px-3.5 py-2.5 text-left text-[13px] font-medium text-gray-600';
  const cellClass = 'border-b border-line px-3.5 py-3 align-middle text-sm';
  const logTone = (action: string) => {
    if (action.includes('ปรับ')) return 'bg-warn-bg text-warn';
    if (action.includes('ให้ยืม')) return 'bg-warn-bg text-warn';
    if (action.includes('ยืม')) return 'bg-blue-100 text-blue-800';
    if (action.includes('รับ') || action.includes('คืน')) return 'bg-ok-bg text-ok';
    return 'bg-gray-200 text-gray-800';
  };
  const signedQty = (log: LogEntry) => {
    const isReceive = log.action.includes('รับเข้า');
    const isIssue = log.action.includes('เบิก');
    if (isReceive) return { text: `+${Math.abs(log.qty)}`, tone: 'text-ok' };
    if (isIssue) return { text: `-${Math.abs(log.qty)}`, tone: 'text-crit' };
    return { text: `${log.qty > 0 ? '+' : ''}${log.qty}`, tone: log.qty > 0 ? 'text-ok' : 'text-crit' };
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[32px] font-medium leading-tight text-ink">ศูนย์ตรวจสอบรายการ (Audit Center)</h1>
          <p className="mt-1.5 text-[15px] text-gray-600">ทุกการรับเข้า เบิกจ่าย ยืม และปรับยอดถูกบันทึกพร้อมผู้ทำรายการ</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchLogs()}
            aria-label="รีเฟรชข้อมูล"
            title="รีเฟรชข้อมูล"
            className="inline-flex items-center rounded-[10px] border border-line bg-white px-3 py-[9px] text-gray-700 transition hover:bg-gray-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={exportCSV}
            className="inline-flex items-center gap-2 rounded-[10px] border border-ink bg-ink px-4 py-[9px] text-sm font-medium text-white transition hover:bg-black"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="rounded-xl bg-crit-bg px-4 py-3 text-sm font-medium text-crit">
          โหลดประวัติรายการไม่สำเร็จ: {loadError}
        </div>
      )}

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="กรองตามประเภทรายการ">
            {LOG_ACTION_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                aria-pressed={actionFilter === chip.value}
                onClick={() => setActionFilter(chip.value)}
                className={`rounded-[10px] border px-3 py-1.5 text-[13px] font-medium transition-colors ${actionFilter === chip.value ? 'border-ink bg-ink text-white' : 'border-line bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 py-0.5 text-sm">
              <Calendar size={14} className="text-gray-600" aria-hidden="true" />
              <input type="date" aria-label="วันที่เริ่มต้น" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent p-1 text-[13px] outline-none" />
              <span className="text-gray-600">-</span>
              <input type="date" aria-label="วันที่สิ้นสุด" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent p-1 text-[13px] outline-none" />
            </div>
            <input
              type="text"
              aria-label="ค้นหาน้ำยา, lot หรือผู้ทำรายการ"
              placeholder="ค้นหาน้ำยา, lot หรือผู้ทำรายการ"
              className={`${fieldClass} w-[280px] max-w-full`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {loading && logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="animate-spin text-gray-600" size={36} />
            <p className="text-sm text-gray-600">กำลังดึงข้อมูลประวัติ...</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
                <caption className="sr-only">ประวัติรายการ</caption>
                <thead>
                  <tr>
                    <th scope="col" className={`${headClass} rounded-l-[10px]`}>Timestamp</th>
                    <th scope="col" className={headClass}>Reagent Detail</th>
                    <th scope="col" className={`${headClass} text-center`}>Type</th>
                    <th scope="col" className={`${headClass} text-center`}>Qty</th>
                    <th scope="col" className={`${headClass} rounded-r-[10px] text-right`}>Performed By</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const isReconcile = log.action.includes('ปรับปรุงยอด');
                    const qty = signedQty(log);
                    return (
                      <tr key={log.id} className="transition-colors hover:bg-[#fafafa]">
                        <td className={`${cellClass} whitespace-nowrap text-[13px] text-gray-600`}>
                          {new Date(log.timestamp).toLocaleString('th-TH', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </td>
                        <td className={cellClass}>
                          <div className="font-medium">{log.name}</div>
                          <div className="text-xs text-gray-600">{log.itemId} · Lot {log.lotNo}</div>
                        </td>
                        <td className={`${cellClass} text-center`}>
                          <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-medium ${logTone(log.action)}`}>
                            {isReconcile ? 'ปรับยอด' : log.action.includes('รับเข้า') ? 'รับเข้า' : log.action.split(' ')[0]}
                          </span>
                        </td>
                        <td className={`${cellClass} text-center font-semibold ${qty.tone}`}>{qty.text}</td>
                        <td className={`${cellClass} text-right`}>{log.user}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!loading && logs.length === 0 && (
              <p className="px-3.5 py-8 text-gray-600">ไม่พบรายการที่ตรงกับตัวกรอง</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
