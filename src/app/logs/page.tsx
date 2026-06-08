'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { 
  Search, 
  Download, 
  Loader2,
  ArrowUpFromLine,
  ArrowDownToLine,
  RefreshCw,
  Calendar,
  Activity
} from 'lucide-react';

interface LogEntry {
  id?: number;
  timestamp: string;
  itemId: string;
  name: string;
  lotNo: string;
  action: string;
  qty: number;
  user: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.getLogs(500, {
        search: searchTerm,
        action: actionFilter,
        startDate,
        endDate
      });
      setLogs(data);
    } catch (err) {
      console.error(err);
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">ศูนย์ตรวจสอบรายการ (Audit Center)</h1>
          <p className="text-gray-500 text-sm font-bold">สืบค้นประวัติการรับเข้าและเบิกจ่ายเชิงลึกด้วย SQL</p>
        </div>
        
        <div className="flex items-center gap-2">
           <button 
            onClick={() => fetchLogs()}
            className="p-3 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl shadow-lg hover:bg-blue-700 transition-all font-bold text-xs uppercase tracking-widest"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Advanced Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="ค้นหาตามชื่อ, รหัส หรือ Lot..."
            className="w-full pl-12 pr-4 py-4 bg-white rounded-[1.5rem] border border-gray-100 shadow-sm outline-none font-bold text-sm focus:ring-2 focus:ring-blue-500/20 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <select 
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="px-4 py-4 bg-white rounded-[1.5rem] border border-gray-100 shadow-sm outline-none font-bold text-sm text-gray-700 appearance-none cursor-pointer"
        >
          <option value="">ทุกประเภทรายการ</option>
          <option value="รับเข้าสต๊อกหลัก">รับเข้าสต๊อกหลัก</option>
          <option value="เบิกไปหน้างาน">เบิกไปหน้างาน</option>
          <option value="ปรับปรุงยอดสต๊อก (Reconciliation)">ปรับปรุงยอด (Reconcile)</option>
        </select>

        <div className="flex items-center gap-2 bg-white px-4 py-1 rounded-[1.5rem] border border-gray-100 shadow-sm">
          <Calendar size={16} className="text-gray-400" />
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-gray-400 uppercase">Range</span>
            <div className="flex items-center gap-1">
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent border-none text-[10px] font-bold outline-none w-24"
              />
              <span className="text-gray-300">-</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent border-none text-[10px] font-bold outline-none w-24"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-20 flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-blue-600" size={40} />
            <p className="text-gray-400 font-bold text-xs uppercase tracking-widest">กำลังดึงข้อมูลประวัติ...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Timestamp</th>
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Reagent Detail</th>
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Type</th>
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Qty</th>
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log, idx) => {
                  const isReceive = log.action === 'รับเข้าสต๊อกหลัก';
                  const isReconcile = log.action.includes('ปรับปรุงยอด');
                  return (
                    <tr key={idx} className="hover:bg-blue-50/30 transition-colors group">
                      <td className="px-8 py-4 whitespace-nowrap">
                        <p className="font-bold text-gray-900 text-xs">{new Date(log.timestamp).toLocaleString('th-TH', { 
                          day: '2-digit', month: '2-digit', year: '2-digit', 
                          hour: '2-digit', minute: '2-digit' 
                        })}</p>
                      </td>
                      <td className="px-8 py-4">
                        <p className="font-bold text-gray-800 text-sm group-hover:text-blue-600 transition-colors">{log.name}</p>
                        <div className="flex gap-2 items-center mt-1">
                          <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">ID: {log.itemId}</span>
                          <span className="text-[10px] font-black text-gray-400 bg-gray-50 px-2 py-0.5 rounded-lg border border-gray-100">LOT: {log.lotNo}</span>
                        </div>
                      </td>
                      <td className="px-8 py-4 text-center">
                        <span className={`
                          inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tight
                          ${isReceive ? 'bg-green-100 text-green-700' : isReconcile ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}
                        `}>
                          {isReceive ? <ArrowDownToLine size={12} /> : isReconcile ? <Activity size={12} /> : <ArrowUpFromLine size={12} />}
                          {isReconcile ? 'Reconcile' : log.action.split(' ')[0]}
                        </span>
                      </td>
                      <td className="px-8 py-4 text-center">
                        <span className={`font-black text-lg ${isReceive ? 'text-green-600' : 'text-gray-900'}`}>{log.qty}</span>
                      </td>
                      <td className="px-8 py-4 text-right">
                        <div className="inline-flex flex-col items-end">
                          <p className="text-xs font-black text-gray-700">{log.user?.split(' ')[0]}</p>
                          <p className="text-[9px] font-bold text-gray-400 uppercase">{log.user?.includes('(') ? log.user.split('(')[1].replace(')', '') : 'STAFF'}</p>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && logs.length === 0 && (
              <div className="p-20 text-center flex flex-col items-center gap-3">
                <Activity className="text-gray-200" size={48} />
                <p className="text-gray-400 font-bold text-sm italic">ไม่พบประวัติรายการที่ตรงตามเงื่อนไขการค้นหา</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
