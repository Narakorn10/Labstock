import React, { useState, useEffect } from 'react';
import { gasRun } from '../api';

const LogsTab = ({ showToast }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadLogs = async () => { 
        setLoading(true); 
        const res = await gasRun('getLogs'); 
        setLogs(res); 
        setLoading(false); 
    };

    useEffect(() => { loadLogs(); }, []);

    const exportCSV = async () => {
        showToast("กำลังเตรียมไฟล์...", "success");
        const data = await gasRun('getAllLogsForExport');
        if(!data || data.length === 0) return showToast("ไม่มีข้อมูล", "error");
        let csvContent = "\uFEFF"; 
        data.forEach(row => csvContent += row.map(cell => `"${(cell||'').toString().replace(/"/g, '""')}"`).join(",") + "\n");
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
        link.download = `Logs_${new Date().toISOString().slice(0,10)}.csv`; link.click();
    };

    const clearLogs = async () => {
        if(confirm("คำเตือน: ประวัติจะถูกลบถาวรทั้งหมด\n\nยืนยันหรือไม่?")) {
            showToast("กำลังลบประวัติ...");
            const res = await gasRun('clearLogs');
            showToast(res.message, res.success ? 'success' : 'error');
            loadLogs();
        }
    }

    return (
        <div className="space-y-4 sm:space-y-6 animate-slide-up pb-24">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex justify-between w-full sm:w-auto items-center">
                    <div><h2 className="text-xl font-bold text-slate-800">ประวัติการทำรายการ</h2><p className="text-xs text-slate-500 mt-1">100 รายการล่าสุด</p></div>
                    <button onClick={loadLogs} className="sm:hidden w-10 h-10 flex items-center justify-center bg-slate-50 text-slate-600 rounded-full active-scale transition"><i className={`fa-solid fa-rotate-right ${loading?'fa-spin':''}`}></i></button>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button onClick={loadLogs} className="hidden sm:flex w-10 h-10 items-center justify-center bg-slate-50 text-slate-600 rounded-full active-scale transition"><i className={`fa-solid fa-rotate-right ${loading?'fa-spin':''}`}></i></button>
                    <button onClick={exportCSV} className="flex-1 sm:flex-none px-4 h-10 bg-emerald-50 text-emerald-700 font-medium text-xs rounded-xl active-scale transition border border-emerald-200"><i className="fa-solid fa-file-excel mr-1"></i> ดาวน์โหลด</button>
                    <button onClick={clearLogs} className="flex-1 sm:flex-none px-4 h-10 bg-rose-50 text-rose-700 font-medium text-xs rounded-xl active-scale transition border border-rose-200"><i className="fa-solid fa-trash-can mr-1"></i> ล้างข้อมูล</button>
                </div>
            </div>
            <div className="space-y-3">
                {loading ? <div className="text-center py-8 text-slate-400">กำลังโหลด...</div> : 
                 logs.length === 0 ? <div className="text-center py-8 text-slate-400 bg-white rounded-xl border border-slate-100">ไม่มีประวัติ</div> :
                 logs.map((i, idx) => {
                    const isRec = i.action.includes('รับ');
                    return (
                        <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isRec?'bg-green-50 text-green-600':'bg-red-50 text-red-600'}`}><i className={`fa-solid ${isRec?'fa-arrow-down':'fa-arrow-up'}`}></i></div>
                            <div className="flex-1 overflow-hidden">
                                <div className="font-bold text-slate-700 text-sm truncate">{i.name}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">{new Date(i.timestamp).toLocaleString('th-TH', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})} <span className="mx-1">•</span> Lot: {i.lotNo}</div>
                            </div>
                            <div className={`font-bold text-base ${isRec?'text-green-600':'text-red-600'}`}>{isRec?'+':'-'}{i.qty}</div>
                        </div>
                    )
                })}
            </div>
        </div>
    );
};

export default LogsTab;
