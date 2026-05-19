import React, { useState, useEffect, useMemo } from 'react';
import { gasRun } from '../api';
import { SkeletonRow } from '../components/Skeleton';

const LogsTab = ({ showToast }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    
    // Filters
    const [startDate, setStartDate] = useState(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [itemSearch, setItemSearch] = useState("");

    const loadLogs = async () => { 
        setLoading(true); 
        const res = await gasRun('getLogs'); 
        setLogs(res); 
        setLoading(false); 
    };

    useEffect(() => { loadLogs(); }, []);

    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            const date = log.timestamp.split('T')[0];
            const matchDate = date >= startDate && date <= endDate;
            const matchItem = log.name.toLowerCase().includes(itemSearch.toLowerCase()) || 
                            log.itemId.toLowerCase().includes(itemSearch.toLowerCase());
            return matchDate && matchItem;
        });
    }, [logs, startDate, endDate, itemSearch]);

    const exportCSV = async () => {
        showToast("กำลังเตรียมไฟล์...", "success");
        const data = await gasRun('getAllLogsForExport');
        if(!data || data.length === 0) return showToast("ไม่มีข้อมูล", "error");
        
        // Remove Item ID (index 1) from each row for export
        const filteredExportData = data.map(row => {
            const newRow = [...row];
            newRow.splice(1, 1); // Remove the Item ID column (index 1)
            return newRow;
        });

        let csvContent = "\uFEFF"; 
        filteredExportData.forEach(row => csvContent += row.map(cell => `"${(cell||'').toString().replace(/"/g, '""')}"`).join(",") + "\n");
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
        link.download = `Logs_Detailed_${new Date().toISOString().slice(0,10)}.csv`; link.click();
    };

    const exportUsageSummary = async () => {
        showToast("กำลังคำนวณสรุปผลการใช้...");
        const summary = await gasRun('getUsageReport', startDate, endDate);
        if(!summary || summary.length === 0) return showToast("ไม่พบรายการในช่วงเวลาที่เลือก", "error");

        let csv = "\uFEFFรหัสน้ำยา,ชื่อน้ำยา,เบิกจ่ายรวม,ปรับปรุงยอดรวม,รับเข้ารวม\n";
        summary.forEach(i => {
            csv += `"${i.itemId}","${i.name}",${i.dispensed},${i.adjusted},${i.received}\n`;
        });

        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        link.download = `Usage_Summary_${startDate}_to_${endDate}.csv`;
        link.click();
        showToast("ดาวน์โหลดรายงานสรุปแล้ว");
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
                    <div><h2 className="text-xl font-bold text-slate-800">ประวัติการทำรายการ</h2><p className="text-xs text-slate-500 mt-1">ตรวจสอบความเคลื่อนไหว</p></div>
                    <button onClick={loadLogs} className="sm:hidden w-10 h-10 flex items-center justify-center bg-slate-50 text-slate-600 rounded-full active-scale transition border border-slate-100"><i className={`fa-solid fa-rotate-right ${loading?'fa-spin':''}`}></i></button>
                </div>
                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                    <button onClick={exportUsageSummary} className="flex-1 sm:flex-none px-4 h-10 bg-indigo-50 text-indigo-700 font-bold text-[10px] uppercase tracking-wider rounded-xl active-scale transition border border-indigo-200"><i className="fa-solid fa-chart-line mr-1.5"></i> สรุปยอดการใช้</button>
                    <button onClick={exportCSV} className="flex-1 sm:flex-none px-4 h-10 bg-emerald-50 text-emerald-700 font-bold text-[10px] uppercase tracking-wider rounded-xl active-scale transition border border-emerald-200"><i className="fa-solid fa-file-excel mr-1.5"></i> ประวัติละเอียด</button>
                    <button onClick={clearLogs} className="flex-1 sm:flex-none px-4 h-10 bg-rose-50 text-rose-700 font-bold text-[10px] uppercase tracking-wider rounded-xl active-scale transition border border-rose-200"><i className="fa-solid fa-trash-can mr-1.5"></i> ล้าง</button>
                </div>
            </div>

            {/* Filters Section */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">ช่วงวันที่</label>
                    <div className="flex items-center gap-2">
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                        <span className="text-slate-300">-</span>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                </div>
                <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">ค้นหาน้ำยา</label>
                    <div className="relative">
                        <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                        <input type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)} placeholder="พิมพ์ชื่อหรือรหัสน้ำยาเพื่อกรอง..." className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                {loading ? Array(5).fill(0).map((_, i) => <SkeletonRow key={i} />) : 
                 filteredLogs.length === 0 ? (
                    <div className="text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-100 animate-fade-in">
                        <i className="fa-solid fa-clock-rotate-left text-4xl mb-4 opacity-20"></i>
                        <p>ไม่มีประวัติในช่วงเวลาที่เลือก</p>
                    </div>
                 ) :
                 filteredLogs.map((i, idx) => {
                    const isRec = i.action.includes('รับ');
                    const isAdj = i.action.includes('ปรับปรุง');
                    
                    let iconBg = 'bg-red-50 text-red-600';
                    let iconName = 'fa-arrow-up';
                    if (isRec) { iconBg = 'bg-green-50 text-green-600'; iconName = 'fa-arrow-down'; }
                    if (isAdj) { iconBg = 'bg-amber-50 text-amber-600'; iconName = 'fa-pen-to-square'; }

                    return (
                        <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 hover:border-slate-200 transition animate-fade-in">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${iconBg}`}><i className={`fa-solid ${iconName}`}></i></div>
                            <div className="flex-1 overflow-hidden">
                                <div className="font-bold text-slate-700 text-sm truncate">{i.name}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                    {new Date(i.timestamp).toLocaleString('th-TH', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})} 
                                    <span className="mx-1">•</span> Lot: {i.lotNo}
                                    {isAdj && i.user && <span className="ml-1 text-amber-600">[{i.user}]</span>}
                                </div>
                            </div>
                            <div className={`font-bold text-base ${isRec?'text-green-600':isAdj?'text-amber-600':'text-red-600'}`}>
                                {isRec?'+':isAdj?'':'-'}{i.qty}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    );
};

export default LogsTab;
