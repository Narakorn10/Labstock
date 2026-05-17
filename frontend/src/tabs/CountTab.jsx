import React, { useState, useMemo } from 'react';
import Select2 from '../components/Select2';

const CountTab = ({ settings, activeDashboard, inputs, setInputs, dispenseCart, setDispenseCart, dispensedItems, onGoToDispense, showToast }) => {
    const [search, setSearch] = useState("");
    const [fReagent, setFReagent] = useState(['ALL']);
    const [fJob, setFJob] = useState(['ALL']);
    
    const filteredData = useMemo(() => {
        const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
        return activeDashboard.filter(item => {
            if (terms.length > 0) {
                const itemIdSafe = (item.itemId || '').toString().toLowerCase().trim();
                const nameSafe = (item.name || '').toString().toLowerCase().trim();
                const qrCodeSafe = (item.qrCode || '').toString().toLowerCase().trim();
                const text = `${itemIdSafe} ${nameSafe} ${qrCodeSafe}`;
                if (!terms.every(t => text.includes(t))) return false;
            }
            if (!fReagent.includes('ALL') && !fReagent.includes(item.reagentType)) return false;
            if (!fJob.includes('ALL') && !fJob.includes(item.jobType)) return false;
            return true;
        });
    }, [activeDashboard, search, fReagent, fJob]);

    const handleInput = (id, val) => setInputs(prev => ({...prev, [id]: val}));

    const handleAddToCart = (item, diff) => {
        let remaining = diff;
        const sortedLots = [...item.lots].sort((a, b) => new Date(a.expDate) - new Date(b.expDate));
        const newCartItems = [];
        for (let lot of sortedLots) {
            if (remaining <= 0) break;
            const inCartQty = dispenseCart.filter(c => c.rowIndex === lot.rowIndex).reduce((sum, c) => sum + c.qty, 0);
            const availableInLot = lot.qty - inCartQty;

            if (availableInLot > 0) {
                const take = Math.min(availableInLot, remaining);
                newCartItems.push({
                    itemId: item.itemId,
                    name: item.name,
                    qty: take,
                    unit: item.unit,
                    rowIndex: lot.rowIndex,
                    lotNo: lot.lotNo
                });
                remaining -= take;
            }
        }
        
        if (newCartItems.length === 0 && remaining > 0) {
            return showToast(`สต๊อกในระบบไม่พอเบิก`, 'error');
        }

        if (remaining > 0) {
            showToast(`เพิ่มลงตะกร้าแล้ว แต่สต๊อกในระบบไม่พอเบิก (ขาด ${remaining} ${item.unit})`, 'error');
        } else {
            showToast(`เพิ่มลงตะกร้าเบิกแล้ว`, 'success');
        }
        
        setDispenseCart(prev => [...prev, ...newCartItems]);
    };

    return (
        <div className="space-y-4 sm:space-y-6 animate-slide-up pb-32">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 sm:p-6 rounded-2xl shadow-sm text-white">
                <h2 className="text-xl font-bold mb-1">นับสต๊อกหน้างาน</h2>
                <p className="text-blue-100 text-xs sm:text-sm font-medium opacity-90">คำนวณยอดเบิกเติมอัตโนมัติจากเป้าหมายรายสัปดาห์</p>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                <div className="relative">
                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400"></i>
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="พิมพ์รหัส ชื่อ หรือสแกนเพื่อค้นหา..." className="w-full bg-slate-50 text-sm border border-slate-200 rounded-xl pl-10 pr-4 py-3.5 focus:ring-2 focus:ring-blue-500 transition" />
                </div>
                <div className="flex flex-col md:flex-row gap-4">
                    <Select2 label="ประเภทน้ำยา" options={settings.reagentTypes} selected={fReagent} onChange={setFReagent} />
                    <Select2 label="ประเภทงาน" options={settings.jobTypes} selected={fJob} onChange={setFJob} />
                </div>
            </div>

            <div className="space-y-4">
                {filteredData.length === 0 ? <div className="text-center py-8 text-slate-400 bg-white rounded-2xl border border-slate-100">ไม่พบข้อมูล</div> :
                 filteredData.map(item => {
                    const target = parseInt(item.weeklyTarget, 10) || 0;
                    const current = parseInt(inputs[item.itemId], 10);
                    let diff = 0; let showDiff = false;
                    if (!isNaN(current) && current < target) { 
                        diff = target - current; 
                        showDiff = true; 
                    }
                    
                    const isDispensed = dispensedItems.has(item.itemId);
                    const inCartTotal = dispenseCart.filter(c => c.itemId === item.itemId).reduce((sum, c) => sum + c.qty, 0);
                    
                    return (
                        <div key={item.itemId} className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100 transition-all focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-200">
                            <div className="flex justify-between items-start mb-4 border-b border-slate-100 pb-3">
                                <div className="pr-2">
                                    <div className="font-bold text-slate-800 text-base leading-tight">{item.name}</div>
                                    <div className="text-xs text-slate-400 font-mono mt-1">{item.itemId}</div>
                                </div>
                                <div className="bg-slate-50 px-3 py-1.5 rounded-lg text-center border border-slate-100 flex-shrink-0">
                                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">เป้าหมาย</div>
                                    <div className="font-bold text-slate-700">{target} <span className="text-[10px] font-normal">{item.unit}</span></div>
                                </div>
                            </div>
                            
                            {isDispensed ? (
                                <div className="w-full bg-emerald-50 text-emerald-600 py-3.5 rounded-xl font-bold text-sm text-center border border-emerald-100 flex justify-center items-center gap-2">
                                    <i className="fa-solid fa-check-circle"></i> เบิกเติมสต๊อกสำเร็จแล้ว
                                </div>
                            ) : (
                                <div className="flex flex-col sm:flex-row items-center gap-4">
                                    <div className="w-full sm:flex-1 relative">
                                        <label className="absolute -top-2 left-3 bg-white px-1 text-[10px] font-bold text-blue-600 uppercase tracking-wide">นับได้หน้างาน</label>
                                        <input type="number" min="0" step="1" value={inputs[item.itemId] || ''} onChange={e=>handleInput(item.itemId, e.target.value.replace(/[^0-9]/g, ''))} placeholder="ระบุจำนวนเต็ม" className="w-full border border-blue-200 rounded-xl px-4 py-3 text-center font-bold text-lg text-blue-900 focus:bg-blue-50 transition outline-none" />
                                    </div>
                                    <div className="w-full sm:flex-1 flex flex-col justify-end h-full">
                                        {inCartTotal > 0 ? (
                                            <div className="w-full bg-amber-50 text-amber-600 py-3.5 rounded-xl font-bold text-sm text-center border border-amber-100 flex justify-center items-center gap-2">
                                                <i className="fa-solid fa-cart-shopping"></i> อยู่ในตะกร้าเบิก ({inCartTotal})
                                            </div>
                                        ) : showDiff ? (
                                            <button onClick={() => handleAddToCart(item, diff)} className="w-full bg-red-600 hover:bg-red-700 text-white py-3.5 rounded-xl font-bold text-sm active-scale shadow-md shadow-red-200 transition animate-fade-in flex justify-center items-center gap-2">
                                                <i className="fa-solid fa-plus"></i> เพิ่มยอด {diff} ลงตะกร้า
                                            </button>
                                        ) : (
                                            <div className="w-full bg-slate-50 text-slate-400 py-3.5 rounded-xl font-medium text-sm text-center border border-slate-100 flex justify-center items-center gap-2">
                                                <i className="fa-regular fa-face-smile"></i> สต๊อกหน้างานพอใช้
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
            
            {dispenseCart.length > 0 && (
                <div className="fixed bottom-[80px] md:bottom-8 left-1/2 transform -translate-x-1/2 w-11/12 max-w-sm z-50 animate-slide-up">
                    <button onClick={onGoToDispense} className="w-full bg-slate-900 text-white py-4 rounded-full font-bold text-sm shadow-2xl active-scale transition flex justify-between items-center px-6">
                        <span><i className="fa-solid fa-cart-arrow-down mr-2"></i> มีรายการรอเบิก</span>
                        <span className="bg-red-500 text-white w-7 h-7 flex items-center justify-center rounded-full text-xs">{dispenseCart.length}</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default CountTab;
