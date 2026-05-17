import React, { useState, useEffect, useMemo } from 'react';
import { gasRun } from '../api';
import Modal from '../components/Modal';
import Select2 from '../components/Select2';
import Badge from '../components/Badge';
import DesktopTable from '../components/dashboard/DesktopTable';
import MobileCards from '../components/dashboard/MobileCards';
import ReportModal from '../components/dashboard/ReportModal';
import useExport from '../hooks/useExport';

const DashboardTab = ({ settings, showToast, activeDashboard, setActiveDashboard, externalFilter, clearExternalFilter }) => {
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [fReagent, setFReagent] = useState(['ALL']);
    const [fJob, setFJob] = useState(['ALL']);
    const [fMachine, setFMachine] = useState(['ALL']);
    
    const [lotModalData, setLotModalData] = useState(null);
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [reportType, setReportType] = useState('order');
    const [reportJob, setReportJob] = useState(['ALL']);

    const isFiltered = search !== "" || !fReagent.includes('ALL') || !fJob.includes('ALL') || !fMachine.includes('ALL') || !!externalFilter;

    const resetFilters = () => {
        setSearch("");
        setFReagent(['ALL']);
        setFJob(['ALL']);
        setFMachine(['ALL']);
        if (clearExternalFilter) clearExternalFilter();
    };

    useEffect(() => {
        if (externalFilter) resetFilters();
    }, [externalFilter]);

    useEffect(() => {
        return () => { if (clearExternalFilter) clearExternalFilter(); };
    }, []);

    const loadData = async () => {
        setLoading(true);
        const res = await gasRun('getDashboardData');
        setActiveDashboard(res);
        setLoading(false);
    };

    const filteredData = useMemo(() => {
        const query = search.toLowerCase().trim();
        const now = new Date();
        
        let baseData = activeDashboard.filter(i => {
            if (!i.itemId || !i.name) return false; 

            if (externalFilter === 'low' && i.quantity > i.minThreshold) return false;
            if (externalFilter === 'healthy' && i.quantity <= i.minThreshold) return false;
            if (externalFilter === 'expired') {
                const hasExpired = i.lots.some(l => new Date(l.expDate) < now);
                if (!hasExpired) return false;
            }

            const matchReagent = fReagent.includes('ALL') || fReagent.includes(i.reagentType);
            const matchJob = fJob.includes('ALL') || fJob.includes(i.jobType);
            const matchMachine = fMachine.includes('ALL') || fMachine.includes(i.machineType);
            return matchReagent && matchJob && matchMachine;
        });

        if (!query) return baseData;

        return baseData.filter(i => {
            const itemId = i.itemId.toString().toLowerCase();
            const name = i.name.toString().toLowerCase();
            const qrCode = (i.qrCode || "").toString().toLowerCase();
            return name.includes(query) || itemId === query || qrCode === query;
        }).sort((a, b) => {
            const aName = a.name.toString().toLowerCase();
            const bName = b.name.toString().toLowerCase();
            const aStarts = aName.startsWith(query);
            const bStarts = bName.startsWith(query);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aName.localeCompare(bName);
        });
    }, [activeDashboard, search, fReagent, fJob, fMachine, externalFilter]);

    const reportData = useMemo(() => {
        let data = filteredData;
        if (reportType === 'order') data = data.filter(i => i.quantity <= i.minThreshold);
        if (!reportJob.includes('ALL')) data = data.filter(i => reportJob.includes(i.jobType));
        return data;
    }, [filteredData, reportType, reportJob]);

    const { reportRef, exportCSV, printPDF, copyLine, exportImage } = useExport(reportData, reportType, reportJob, showToast);

    return (
        <div className="space-y-4 sm:space-y-6 animate-slide-up pb-24">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100">
                <div><h2 className="text-xl font-bold text-slate-800">แดชบอร์ดคลัง</h2><p className="text-xs text-slate-500 mt-1">ยอดคงเหลือในสต๊อกหลัก</p></div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button onClick={loadData} className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-slate-50 text-blue-600 rounded-xl hover:bg-blue-50 active-scale transition border border-slate-100"><i className={`fa-solid fa-rotate-right ${loading ? 'fa-spin' : ''}`}></i></button>
                    <button onClick={() => setReportModalOpen(true)} className="flex-1 sm:w-auto px-4 h-12 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-md shadow-blue-200 active-scale transition font-medium"><i className="fa-solid fa-file-invoice"></i> ออกรายงาน</button>
                </div>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                <div className="relative">
                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400"></i>
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="พิมพ์รหัส ชื่อ หรือ Barcode เพื่อค้นหา..." className="w-full bg-slate-50 text-sm border border-slate-200 rounded-xl pl-10 pr-4 py-3.5 focus:ring-2 focus:ring-blue-500 transition outline-none" />
                </div>
                <div className="flex flex-col md:flex-row gap-4">
                    <Select2 label="ประเภทน้ำยา" options={settings.reagentTypes} selected={fReagent} onChange={setFReagent} />
                    <Select2 label="ประเภทงาน" options={settings.jobTypes} selected={fJob} onChange={setFJob} />
                    <Select2 label="เครื่องมือ" options={settings.machineTypes} selected={fMachine} onChange={setFMachine} />
                </div>
                {isFiltered && (
                    <div className="flex justify-start animate-fade-in">
                        <button onClick={resetFilters} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold uppercase tracking-wider hover:bg-slate-200 transition flex items-center gap-2 border border-slate-200">
                            <i className="fa-solid fa-filter-circle-xmark"></i> ล้างตัวกรองทั้งหมด
                        </button>
                    </div>
                )}
            </div>

            <DesktopTable loading={loading} filteredData={filteredData} search={search} setLotModalData={setLotModalData} />
            <MobileCards loading={loading} filteredData={filteredData} search={search} setLotModalData={setLotModalData} />

            <Modal isOpen={!!lotModalData} onClose={() => setLotModalData(null)} title={lotModalData ? lotModalData.name : ''} icon="fa-box-open">
                {lotModalData && (
                    <div className="space-y-3">
                        {lotModalData.lots.length === 0 ? <div className="text-center p-8 text-slate-400">
                            <i className="fa-solid fa-box-open text-3xl mb-2 opacity-20"></i>
                            <p className="text-sm">ไม่มีสต๊อกในระบบ</p>
                        </div> : 
                         [...lotModalData.lots].map((l, idx) => {
                            const isExp = new Date(l.expDate) < new Date();
                            return (
                                <div key={idx} className={`p-4 rounded-xl border flex justify-between items-center ${isExp ? 'bg-red-50 border-red-100' : 'bg-white border-slate-200'} animate-fade-in`}>
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

            <ReportModal 
                isOpen={reportModalOpen} 
                onClose={() => setReportModalOpen(false)}
                reportType={reportType}
                setReportType={setReportType}
                settings={settings}
                reportJob={reportJob}
                setReportJob={setReportJob}
                reportData={reportData}
                reportRef={reportRef}
                exportCSV={exportCSV}
                exportImage={exportImage}
                printPDF={printPDF}
                copyLine={copyLine}
            />
        </div>
    );
};

export default DashboardTab;