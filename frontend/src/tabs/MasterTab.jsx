import React, { useState, useMemo } from 'react';
import { gasRun } from '../api';
import Modal from '../components/Modal';

const MasterTab = ({ settings, showToast, activeDashboard, refreshDashboard }) => {
    const [search, setSearch] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [isEdit, setIsEdit] = useState(false);
    const initForm = { itemId:'', qrCode:'', name:'', reagentType: settings.reagentTypes[0]||'', jobType: settings.jobTypes[0]||'', machineType: settings.machineTypes[0]||'', unit:'', minThreshold:'', weeklyTarget:'' };
    const [form, setForm] = useState(initForm);

    const filteredData = useMemo(() => {
        const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if(terms.length === 0) return activeDashboard;
        return activeDashboard.filter(i => {
            const itemIdSafe = (i.itemId || '').toString().toLowerCase().trim();
            const nameSafe = (i.name || '').toString().toLowerCase().trim();
            const qrCodeSafe = (i.qrCode || '').toString().toLowerCase().trim();
            const txt = `${itemIdSafe} ${nameSafe} ${qrCodeSafe}`;
            return terms.every(t => txt.includes(t));
        });
    }, [activeDashboard, search]);

    const submitForm = async (e) => {
        e.preventDefault(); setModalOpen(false); showToast("กำลังบันทึกข้อมูล...");
        const res = await gasRun(isEdit ? 'updateMasterItem' : 'addMasterItem', form);
        showToast(res.message, res.success ? 'success' : 'error');
        if(res.success) refreshDashboard();
    };

    const setupDB = async () => {
        if(confirm("ระบบจะทำการสร้าง Sheet เริ่มต้น\nยืนยันหรือไม่?")) {
            showToast("กำลังสร้างฐานข้อมูล...");
            const res = await gasRun('setupSystem');
            showToast(res.message, res.success ? 'success' : 'error');
        }
    };

    return (
        <div className="space-y-4 sm:space-y-6 animate-slide-up pb-24">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100">
                <div><h2 className="text-xl font-bold text-slate-800">ข้อมูลหลัก</h2><p className="text-xs text-slate-500 mt-1">จัดการ Master Data</p></div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button onClick={setupDB} className="flex-1 sm:w-auto px-4 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-bold active-scale transition border border-emerald-100"><i className="fa-solid fa-wand-magic-sparkles mr-1"></i> Setup DB</button>
                    <button onClick={() => { setIsEdit(false); setForm(initForm); setModalOpen(true); }} className="w-12 h-10 flex items-center justify-center bg-slate-900 text-white rounded-xl shadow-md active-scale transition"><i className="fa-solid fa-plus"></i></button>
                </div>
            </div>
            
            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100">
                <div className="relative">
                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400"></i>
                    <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหา รหัส, ชื่อ หรือ Barcode..." className="w-full bg-slate-50 text-sm border border-slate-200 rounded-xl pl-10 pr-4 py-3.5 focus:ring-2 focus:ring-slate-900 transition" />
                </div>
            </div>

            <div className="space-y-3">
                {filteredData.map(item => (
                    <div key={item.itemId} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center transition hover:border-slate-300">
                        <div className="overflow-hidden flex-1 pr-4">
                            <div className="font-bold text-slate-800 truncate">{item.name}</div>
                            <div className="text-[10px] text-slate-500 mt-1">{item.itemId} <span className="mx-1">•</span> <i className="fa-solid fa-barcode"></i> {item.qrCode}</div>
                        </div>
                        <button onClick={() => { setIsEdit(true); setForm(item); setModalOpen(true); }} className="w-10 h-10 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 hover:text-slate-900 active-scale transition flex-shrink-0"><i className="fa-solid fa-pen"></i></button>
                    </div>
                ))}
            </div>

            <Modal isOpen={modalOpen} onClose={()=>setModalOpen(false)} title={isEdit ? "แก้ไขรายละเอียด" : "สร้างรายการใหม่"} width="max-w-md" headerColor={isEdit ? "bg-amber-50" : "bg-white"} titleColor={isEdit ? "text-amber-800" : "text-slate-800"}>
                <form onSubmit={submitForm} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Item ID <span className="text-red-500">*</span></label>
                        <input type="text" required value={form.itemId} onChange={e=>setForm({...form, itemId:e.target.value})} disabled={isEdit} className={`w-full border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-900 ${isEdit ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-slate-50'}`}/>
                        {!isEdit && <p className="text-[10px] text-slate-400 mt-1">รหัสใช้ภายในห้องแล็บ (ห้ามซ้ำ)</p>}
                    </div>
                    <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Barcode (รหัสสแกน)</label><input type="text" required value={form.qrCode} onChange={e=>setForm({...form, qrCode:e.target.value})} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-900"/></div>
                    <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">ชื่อน้ำยา</label><input type="text" required value={form.name} onChange={e=>setForm({...form, name:e.target.value})} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-900"/></div>
                    <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">ประเภทน้ำยา</label><select value={form.reagentType} onChange={e=>setForm({...form, reagentType:e.target.value})} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-900">{settings.reagentTypes.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">แผนก/งาน</label><select value={form.jobType} onChange={e=>setForm({...form, jobType:e.target.value})} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500">{settings.jobTypes.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
                        <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">เครื่องมือ</label><select value={form.machineType} onChange={e=>setForm({...form, machineType:e.target.value})} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500">{settings.machineTypes.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">หน่วย</label><input type="text" required value={form.unit} onChange={e=>setForm({...form, unit:e.target.value})} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500"/></div>
                        <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">จุดเตือน (Min)</label><input type="number" step="1" min="0" required value={form.minThreshold} onChange={e=>setForm({...form, minThreshold:e.target.value.replace(/[^0-9]/g, '')})} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500"/></div>
                    </div>
                    <div><label className="block text-xs font-bold text-blue-600 mb-1 uppercase">เป้าหมายหน้างาน/สัปดาห์</label><input type="number" step="1" min="0" required value={form.weeklyTarget} onChange={e=>setForm({...form, weeklyTarget:e.target.value.replace(/[^0-9]/g, '')})} className="w-full bg-blue-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500"/></div>
                    
                    <button type="submit" className={`w-full text-white py-4 rounded-xl font-bold active-scale shadow-lg mt-6 ${isEdit ? 'bg-amber-600 shadow-amber-200' : 'bg-slate-900 shadow-slate-200'}`}>บันทึกข้อมูล</button>
                </form>
            </Modal>
        </div>
    );
};

export default MasterTab;
