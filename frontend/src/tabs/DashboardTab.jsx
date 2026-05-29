import { useState, useEffect, useMemo } from 'react';
import { gasRun } from '../api';
import Modal from '../components/Modal';
import Select2 from '../components/Select2';
import Badge from '../components/Badge';
import DesktopTable from '../components/dashboard/DesktopTable';
import MobileCards from '../components/dashboard/MobileCards';
import ReportModal from '../components/dashboard/ReportModal';
import SummaryCards from '../components/dashboard/SummaryCards';
import useExport from '../hooks/useExport';

const DashboardTab = ({ settings, showToast, activeDashboard, setActiveDashboard, externalFilter, clearExternalFilter, user }) => {
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [fReagent, setFReagent] = useState(['ALL']);
    const [fJob, setFJob] = useState(['ALL']);
    const [fMachine, setFMachine] = useState(['ALL']);
    const [localFilter, setLocalFilter] = useState(externalFilter || 'all');
    
    const [lotModalData, setLotModalData] = useState(null);
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [reportType, setReportType] = useState('order');
    const [reportJob, setReportJob] = useState(['ALL']);

    const stats = useMemo(() => {
        const totalItems = activeDashboard.length;
        const lowStockItems = activeDashboard.filter(i => i.quantity <= i.minThreshold).length;
        const healthyItems = totalItems - lowStockItems;
        let expiredLotsCount = 0;
        const now = new Date();
        activeDashboard.forEach(item => {
            item.lots.forEach(lot => { if (new Date(lot.expDate) < now) expiredLotsCount++; });
        });
        return { totalItems, lowStockItems, healthyItems, expiredLotsCount };
    }, [activeDashboard]);

    const activeMainFilter = externalFilter || localFilter;

    const isFiltered = search !== "" || !fReagent.includes('ALL') || !fJob.includes('ALL') || !fMachine.includes('ALL') || activeMainFilter !== 'all';

    const resetFilters = () => {
        setSearch("");
        setFReagent(['ALL']);
        setFJob(['ALL']);
        setFMachine(['ALL']);
        setLocalFilter('all');
        if (clearExternalFilter) clearExternalFilter();
    };

    useEffect(() => {
        if (externalFilter) {
            const syncFilters = async () => {
                setLocalFilter(externalFilter);
                setSearch("");
                setFReagent(['ALL']);
                setFJob(['ALL']);
                setFMachine(['ALL']);
            };
            syncFilters();
        }
    }, [externalFilter]);

    useEffect(() => {
        return () => { if (clearExternalFilter) clearExternalFilter(); };
    }, [clearExternalFilter]);

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

            if (activeMainFilter === 'low' && i.quantity > i.minThreshold) return false;
            if (activeMainFilter === 'healthy' && i.quantity <= i.minThreshold) return false;
            if (activeMainFilter === 'expired') {
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
    }, [activeDashboard, search, fReagent, fJob, fMachine, activeMainFilter]);

    const reportData = useMemo(() => {
        let data = filteredData;
        if (reportType === 'order') data = data.filter(i => i.quantity <= i.minThreshold);
        if (!reportJob.includes('ALL')) data = data.filter(i => reportJob.includes(i.jobType));
        return data;
    }, [filteredData, reportType, reportJob]);

    const { reportRef, exportCSV, printPDF, copyLine } = useExport(reportData, reportType, reportJob, showToast);

    const [editingLot, setEditingLot] = useState(null); // { rowIndex, lotNo, currentQty }
    const [newLotQty, setNewLotQty] = useState("");

    const handleAdjustQty = async (e) => {
        e.preventDefault();
        if (!editingLot || newLotQty === "") return;
        
        showToast("กำลังปรับปรุงยอด...");
        const res = await gasRun('adjustLotQuantity', {
            rowIndex: editingLot.rowIndex,
            itemId: lotModalData.itemId,
            lotNo: editingLot.lotNo,
            newQty: newLotQty
        });

        showToast(res.message, res.success ? 'success' : 'error');
        if (res.success) {
            setEditingLot(null);
            setNewLotQty("");
            loadData(); // รีเฟรชข้อมูลทั้งหมด
            // อัปเดตข้อมูลใน Modal ทันทีเพื่อความลื่นไหล
            const updatedLots = lotModalData.lots.map(l => 
                l.rowIndex === editingLot.rowIndex ? { ...l, qty: parseInt(newLotQty, 10) } : l
            );
            setLotModalData({ ...lotModalData, lots: updatedLots });
        }
    };

    return (
        <div className="space-y-4 sm:space-y-6 animate-slide-up pb-24">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100">
                <div><h2 className="text-xl font-bold text-slate-800">แดชบอร์ดคลัง</h2><p className="text-xs text-slate-500 mt-1">ยอดคงเหลือในสต๊อกหลัก</p></div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button onClick={loadData} className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-slate-50 text-blue-600 rounded-xl hover:bg-blue-50 active-scale transition border border-slate-100"><i className={`fa-solid fa-rotate-right ${loading ? 'fa-spin' : ''}`}></i></button>
                    <button onClick={() => setReportModalOpen(true)} className="flex-1 sm:w-auto px-4 h-12 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-md shadow-blue-200 active-scale transition font-medium"><i className="fa-solid fa-file-invoice"></i> ออกรายงาน</button>
                </div>
            </div>

            <SummaryCards stats={stats} activeFilter={activeMainFilter} onFilterClick={setLocalFilter} />

            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                <div className="relative group">
                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors"></i>
                    <input 
                        type="text" 
                        value={search} 
                        onChange={e => setSearch(e.target.value)} 
                        placeholder="พิมพ์รหัส ชื่อ หรือ Barcode เพื่อค้นหา..." 
                        className="w-full bg-slate-50 text-sm border border-slate-200 rounded-xl pl-10 pr-10 py-3.5 focus:ring-2 focus:ring-blue-500 transition outline-none" 
                    />
                    {search && (
                        <button 
                            type="button" 
                            onClick={() => setSearch("")}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                        >
                            <i className="fa-solid fa-circle-xmark"></i>
                        </button>
                    )}
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

            <Modal isOpen={!!lotModalData} onClose={() => { setLotModalData(null); setEditingLot(null); }} title={lotModalData ? lotModalData.name : ''} icon="fa-box-open">
                {lotModalData && (
                    <div className="space-y-3">
                        {lotModalData.lots.length === 0 ? <div className="text-center p-8 text-slate-400">
                            <i className="fa-solid fa-box-open text-3xl mb-2 opacity-20"></i>
                            <p className="text-sm">ไม่มีสต๊อกในระบบ</p>
                        </div> : 
                         [...lotModalData.lots].map((l, idx) => {
                            const isExp = new Date(l.expDate) < new Date();
                            const isEditing = editingLot?.rowIndex === l.rowIndex;
                            const canEdit = user?.role === 'Manager' || user?.role === 'Admin';
                            
                            return (
                                <div key={idx} className={`p-4 rounded-xl border transition-all ${isExp ? 'bg-red-50 border-red-100' : 'bg-white border-slate-200'} ${isEditing ? 'ring-2 ring-blue-500 border-transparent shadow-lg' : ''} animate-fade-in`}>
                                    <div className="flex justify-between items-center mb-1">
                                        <div className="font-bold text-slate-800 text-sm">{l.lotNo} {isExp && <Badge color="red">EXP</Badge>}</div>
                                        {!isEditing && canEdit && (
                                            <button onClick={() => { setEditingLot(l); setNewLotQty(l.qty); }} className="text-slate-400 hover:text-blue-600 transition p-1"><i className="fa-solid fa-pen-to-square text-xs"></i></button>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-end">
                                        <div className="text-xs text-slate-500">หมดอายุ: {new Date(l.expDate).toLocaleDateString('th-TH')}</div>
                                        {isEditing ? (
                                            <form onSubmit={handleAdjustQty} className="flex items-center gap-2 animate-fade-in">
                                                <div className="relative">
                                                    <input 
                                                        autoFocus
                                                        type="number" 
                                                        value={newLotQty} 
                                                        onChange={e => setNewLotQty(e.target.value)}
                                                        className="w-20 text-center font-bold text-blue-700 bg-blue-50 border-2 border-blue-200 rounded-lg py-1 outline-none"
                                                    />
                                                    <div className="absolute -top-5 left-0 text-[8px] font-bold text-blue-500 uppercase">แก้เป็น</div>
                                                </div>
                                                <button type="submit" className="bg-blue-600 text-white w-8 h-8 rounded-lg shadow-md active-scale"><i className="fa-solid fa-check text-xs"></i></button>
                                                <button type="button" onClick={() => setEditingLot(null)} className="bg-slate-100 text-slate-500 w-8 h-8 rounded-lg active-scale"><i className="fa-solid fa-xmark text-xs"></i></button>
                                            </form>
                                        ) : (
                                            <div className="font-bold text-lg text-slate-800">{l.qty} <span className="text-[10px] font-normal text-slate-500">{lotModalData.unit}</span></div>
                                        )}
                                    </div>
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
                printPDF={printPDF}
                copyLine={copyLine}
            />
        </div>
    );
};

export default DashboardTab;