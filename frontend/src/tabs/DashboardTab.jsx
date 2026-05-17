import React, { useState, useEffect, useMemo } from 'react';
import { gasRun } from '../api';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import Select2 from '../components/Select2';

const DashboardTab = ({ settings, showToast, activeDashboard, setActiveDashboard }) => {
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [fReagent, setFReagent] = useState(['ALL']);
    const [fJob, setFJob] = useState(['ALL']);
    const [fMachine, setFMachine] = useState(['ALL']);
    
    const [lotModalData, setLotModalData] = useState(null);
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [reportType, setReportType] = useState('order');
    const [reportJob, setReportJob] = useState(['ALL']);

    const loadData = async () => {
        setLoading(true); const res = await gasRun('getDashboardData'); setActiveDashboard(res); setLoading(false);
    };

    const filteredData = useMemo(() => {
        const term = search.toLowerCase().trim();
        if (!term) return activeDashboard;

        const terms = term.split(/\s+/).filter(Boolean);
        
        return activeDashboard.filter(i => {
            const itemId = (i.itemId || '').toString().toLowerCase();
            const name = (i.name || '').toString().toLowerCase();
            const qrCode = (i.qrCode || '').toString().toLowerCase();

            // 1. ถ้าเป็นการแสกน (รหัสตรงเป๊ะ) ให้แสดงทันที
            if (itemId === term || qrCode === term) return true;

            // 2. ถ้าเป็นการพิมพ์ชื่อ ให้เช็คว่าทุกคำที่พิมพ์มีอยู่ในชื่อ หรือรหัส
            const isMatch = terms.every(t => name.includes(t) || itemId.includes(t));
            
            // เพิ่มการเช็คตัวเลือก (Dropdown)
            const matchReagent = fReagent.includes('ALL') || fReagent.includes(i.reagentType);
            const matchJob = fJob.includes('ALL') || fJob.includes(i.jobType);
            const matchMachine = fMachine.includes('ALL') || fMachine.includes(i.machineType);

            return isMatch && matchReagent && matchJob && matchMachine;
        }).sort((a, b) => {
            // เรียงลำดับ: ให้ตัวที่ชื่อขึ้นต้นด้วยคำค้นหาอยู่บนสุด
            const aName = (a.name || '').toLowerCase();
            const bName = (b.name || '').toLowerCase();
            const aStarts = aName.startsWith(term);
            const bStarts = bName.startsWith(term);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return 0;
        });
    }, [activeDashboard, search, fReagent, fJob, fMachine]);

    const reportData = useMemo(() => {
        let data = filteredData;
        if (reportType === 'order') data = data.filter(i => i.quantity <= i.minThreshold);
        if (!reportJob.includes('ALL')) data = data.filter(i => reportJob.includes(i.jobType));
        return data;
    }, [filteredData, reportType, reportJob]);

    const exportCSV = () => {
        if (reportData.length === 0) return showToast("ไม่มีข้อมูลให้ดาวน์โหลด", "error");
        let csv = "\uFEFFรหัสน้ำยา (Item ID),ชื่อน้ำยา,ประเภทงาน,เครื่องมือ,จุดแจ้งเตือน,คงเหลือ,หน่วย\n";
        reportData.forEach(i => csv += `"${i.itemId}","${(i.name||'').replace(/"/g,'""')}","${i.jobType}","${i.machineType}",${i.minThreshold},${i.quantity},"${i.unit}"\n`);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        link.download = `Report_Reagent_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    };

    const printPDF = () => {
        if (reportData.length === 0) return showToast("ไม่มีข้อมูลให้พิมพ์", "error");
        let title = reportType === 'order' ? "สรุปรายการน้ำยาที่ต้องสั่งซื้อเพิ่ม" : "สรุปยอดคงเหลือสต๊อกหลักปัจจุบัน";
        if (!reportJob.includes('ALL')) title += ` (แผนก: ${reportJob.join(', ')})`;
        let html = `<html><head><title>${title}</title><style>body{font-family:Tahoma,sans-serif;} table{width:100%;border-collapse:collapse;margin-top:10px;} th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:14px;} th{background:#f3f4f6;} .alert{color:red;font-weight:bold;}</style></head><body><h2>${title}</h2><table><tr><th>รหัส</th><th>ชื่อน้ำยา</th><th>แผนก</th><th style="text-align:right">คงเหลือ</th></tr>`;
        reportData.forEach(i => html += `<tr><td>${i.itemId}</td><td>${i.name}</td><td>${i.jobType}</td><td style="text-align:right" class="${i.quantity<=i.minThreshold?'alert':''}">${i.quantity} ${i.unit}</td></tr>`);
        html += `</table><p style="text-align:right;font-size:12px;margin-top:20px;">พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}</p></body></html>`;
        const iframe = document.createElement('iframe'); iframe.style.display = 'none'; document.body.appendChild(iframe);
        iframe.contentDocument.write(html); iframe.contentDocument.close();
        setTimeout(() => { iframe.contentWindow.print(); document.body.removeChild(iframe); }, 250);
    };

    const copyLine = () => {
        if (reportData.length === 0) return showToast("ไม่มีรายการให้คัดลอก", "error");
        let title = reportType === 'order' ? "⚠️ ต้องสั่งซื้อเพิ่ม" : "📊 สรุปยอดคงเหลือ";
        if (!reportJob.includes('ALL')) title += `\n[แผนก: ${reportJob.join(', ')}]`;
        let text = `${title}\n` + "=".repeat(20) + "\n";
        reportData.forEach(i => text += `• ${i.name}\n  คงเหลือ: ${i.quantity} ${i.unit} (เตือน: ${i.minThreshold})\n`);
        const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
        showToast("คัดลอกข้อความแล้ว นำไปวางใน Line ได้เลย");
    };

    return (
        <div className="space-y-4 sm:space-y-6 animate-slide-up pb-24">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100">
                <div><h2 className="text-xl font-bold text-slate-800">แดชบอร์ดคลัง</h2><p className="text-xs text-slate-500 mt-1">ยอดคงเหลือในสต๊อกหลัก</p></div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button onClick={loadData} className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-slate-50 text-blue-600 rounded-xl hover:bg-blue-50 active-scale transition"><i className={`fa-solid fa-rotate-right ${loading ? 'fa-spin' : ''}`}></i></button>
                    <button onClick={() => setReportModalOpen(true)} className="flex-1 sm:w-auto px-4 h-12 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-md shadow-blue-200 active-scale transition font-medium"><i className="fa-solid fa-file-invoice"></i> ออกรายงาน</button>
                </div>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                <div className="relative">
                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400"></i>
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="พิมพ์รหัส ชื่อ หรือ Barcode เพื่อค้นหา..." className="w-full bg-slate-50 text-sm border border-slate-200 rounded-xl pl-10 pr-4 py-3.5 focus:ring-2 focus:ring-blue-500 transition" />
                </div>
                <div className="flex flex-col md:flex-row gap-4">
                    <Select2 label="ประเภทน้ำยา" options={settings.reagentTypes} selected={fReagent} onChange={setFReagent} />
                    <Select2 label="ประเภทงาน" options={settings.jobTypes} selected={fJob} onChange={setFJob} />
                    <Select2 label="เครื่องมือ" options={settings.machineTypes} selected={fMachine} onChange={setFMachine} />
                </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-100 font-semibold text-slate-600">
                        <tr><th className="px-6 py-4">Item ID</th><th className="px-6 py-4">ชื่อน้ำยา</th><th className="px-6 py-4">หมวดหมู่</th><th className="px-6 py-4 text-right">จุดเตือน</th><th className="px-6 py-4 text-right">คงเหลือ</th><th className="px-6 py-4 text-center">จัดการ</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 text-slate-700">
                        {loading ? <tr><td colSpan="6" className="text-center py-8 text-slate-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</td></tr> :
                         filteredData.length === 0 ? <tr><td colSpan="6" className="text-center py-8 text-slate-400">ไม่พบข้อมูลที่ตรงกับตัวกรอง</td></tr> :
                         filteredData.map(item => {
                             const alert = item.quantity <= item.minThreshold;
                             return (
                                <tr key={item.itemId} className="hover:bg-slate-50/50 transition">
                                    <td className="px-6 py-4"><div className="font-bold text-slate-800">{item.itemId}</div><div className="text-[10px] text-slate-400 font-mono mt-1"><i className="fa-solid fa-barcode mr-1"></i>{item.qrCode}</div></td>
                                    <td className="px-6 py-4 font-medium text-slate-800">{item.name}</td>
                                    <td className="px-6 py-4"><div className="flex flex-col gap-1 items-start"><Badge color="blue">{item.reagentType}</Badge><Badge color="green">{item.jobType}</Badge><Badge color="purple">{item.machineType}</Badge></div></td>
                                    <td className="px-6 py-4 text-right text-slate-400">{item.minThreshold}</td>
                                    <td className={`px-6 py-4 text-right text-lg ${alert ? 'text-red-500 font-bold' : 'font-bold'}`}>{item.quantity} <span className="text-xs font-medium text-slate-500">{item.unit}</span></td>
                                    <td className="px-6 py-4 text-center"><button onClick={() => setLotModalData(item)} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-bold active-scale transition">ราย Lot ({item.lots.length})</button></td>
                                </tr>
                             )
                         })}
                    </tbody>
                </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-4 pb-4">
                {loading ? <div className="text-center py-8 text-slate-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i>กำลังโหลด...</div> :
                 filteredData.length === 0 ? <div className="text-center py-8 text-slate-400 bg-white rounded-2xl border border-slate-100">ไม่พบข้อมูลที่ตรงกับตัวกรอง</div> :
                 filteredData.map(item => {
                    const alert = item.quantity <= item.minThreshold;
                    return (
                        <div key={item.itemId} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                            <div className="flex justify-between items-start mb-3">
                                <div className="pr-4">
                                    <div className="text-[10px] font-bold text-slate-400 mb-0.5">{item.itemId}</div>
                                    <div className="font-bold text-slate-800 text-base leading-tight">{item.name}</div>
                                </div>
                                <div className={`flex flex-col items-end ${alert ? 'text-red-600' : 'text-slate-800'}`}>
                                    <span className="font-bold text-2xl leading-none">{item.quantity}</span>
                                    <span className="text-[10px] font-medium text-slate-500 mt-1 uppercase">{item.unit}</span>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mb-4"><Badge color="blue">{item.reagentType}</Badge><Badge color="green">{item.jobType}</Badge></div>
                            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                                <div className="text-[11px] text-slate-500">Min Alert: <span className="font-bold text-slate-700">{item.minThreshold}</span></div>
                                <button onClick={() => setLotModalData(item)} className="text-slate-700 font-bold text-xs bg-slate-100 px-4 py-2 rounded-xl active-scale">ดูราย Lot ({item.lots.length})</button>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Modals */}
            <Modal isOpen={!!lotModalData} onClose={() => setLotModalData(null)} title={lotModalData ? lotModalData.name : ''} icon="fa-box-open">
                {lotModalData && (
                    <div className="space-y-3">
                        {lotModalData.lots.length === 0 ? <div className="text-center p-4 text-slate-400">ไม่มีสต๊อก</div> : 
                         [...lotModalData.lots].map((l, idx) => {
                            const isExp = new Date(l.expDate) < new Date();
                            return (
                                <div key={idx} className={`p-4 rounded-xl border flex justify-between items-center ${isExp ? 'bg-red-50 border-red-100' : 'bg-white border-slate-200'}`}>
                                    <div>
                                        <div className="font-bold text-slate-800 text-sm">{l.lotNo} {isExp && <Badge color="red">EXP</Badge>}</div>
                                        <div className="text-xs text-slate-500 mt-1">หมดอายุ: {new Date(l.expDate).toLocaleDateString('th-TH')}</div>
                                    </div>
                                    <div className="font-bold text-lg text-slate-800">{l.qty} <span className="text-[10px] font-normal text-slate-500">{lotModalData.unit}</span></div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </Modal>

            <Modal isOpen={reportModalOpen} onClose={() => setReportModalOpen(false)} title="สร้างรายงานส่งหัวหน้า" width="max-w-2xl" headerColor="bg-slate-50" 
                actions={
                    <React.Fragment>
                        <button onClick={exportCSV} className="w-full sm:w-auto py-3 px-4 bg-emerald-600 text-white rounded-xl text-sm font-medium active-scale shadow-sm"><i className="fa-solid fa-file-excel mr-2"></i>Excel</button>
                        <button onClick={printPDF} className="w-full sm:w-auto py-3 px-4 bg-rose-600 text-white rounded-xl text-sm font-medium active-scale shadow-sm"><i className="fa-solid fa-file-pdf mr-2"></i>PDF/พิมพ์</button>
                        <button onClick={copyLine} className="w-full sm:w-auto py-3 px-4 bg-slate-800 text-white rounded-xl text-sm font-medium active-scale shadow-sm"><i className="fa-brands fa-line mr-2"></i>คัดลอกส่ง Line</button>
                    </React.Fragment>
                }>
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                    <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">ประเภทรายงาน</label>
                        <select value={reportType} onChange={e => setReportType(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm focus:ring-2 focus:ring-blue-500">
                            <option value="order">⚠️ เฉพาะรายการที่ต้องสั่งซื้อ</option>
                            <option value="all">📊 ยอดคงเหลือทั้งหมด</option>
                        </select>
                    </div>
                    <Select2 label="กรองตามประเภทงาน" options={settings.jobTypes} selected={reportJob} onChange={setReportJob} />
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <p className="text-xs text-slate-500 mb-3 font-medium">พบ {reportData.length} รายการ:</p>
                    <div className="space-y-2 max-h-60 overflow-y-auto hide-scroll">
                        {reportData.map(item => (
                            <div key={item.itemId} className="flex justify-between items-center border-b border-slate-200/60 pb-2 last:border-0 last:pb-0">
                                <div className="overflow-hidden pr-2">
                                    <div className="text-sm font-medium text-slate-800 truncate">{item.name}</div>
                                    <div className="text-[10px] text-slate-400">{item.itemId}</div>
                                </div>
                                <div className={`text-sm font-bold whitespace-nowrap ${item.quantity <= item.minThreshold ? 'text-red-600' : 'text-slate-800'}`}>{item.quantity} <span className="text-[10px] font-normal text-slate-500">{item.unit}</span></div>
                            </div>
                        ))}
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default DashboardTab;
