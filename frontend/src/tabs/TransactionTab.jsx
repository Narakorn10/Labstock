import React, { useState, useMemo } from 'react';
import { gasRun, processAnyBarcode } from '../api';
import QRScanner from '../components/QRScanner';
import { highlightText } from '../utils/text';

const TransactionTab = ({ type, showToast, activeDashboard, cart = [], setCart, onSuccess }) => {
    const isRec = type === 'receive';
    const title = isRec ? "รับเข้าคลังหลัก" : "เบิกไปหน้างาน";
    const icon = isRec ? "fa-box text-green-500" : "fa-hand-holding-droplet text-red-500";
    const btnColor = isRec ? "bg-green-600 hover:bg-green-700 shadow-green-200" : "bg-red-600 hover:bg-red-700 shadow-red-200";

    const [scanMode, setScanMode] = useState(false);
    const [search, setSearch] = useState("");
    const [item, setItem] = useState(null);
    const [form, setForm] = useState({ lotNo: '', expDate: '', qty: '' });
    
    const [showAuto, setShowAuto] = useState(false);
    
    // 🔍 Dynamic Search Logic: ค้นหาทันทีจากข้อมูลในเครื่อง
    const autoList = useMemo(() => {
        if(!search || search.length < 2) return [];
        const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
        return activeDashboard.filter(i => {
            const itemIdSafe = (i.itemId || '').toString().toLowerCase().trim();
            const nameSafe = (i.name || '').toString().toLowerCase().trim();
            const qrCodeSafe = (i.qrCode || '').toString().toLowerCase().trim();
            const txt = `${itemIdSafe} ${nameSafe} ${qrCodeSafe}`;
            return terms.every(t => txt.includes(t));
        }).slice(0, 8); 
    }, [search, activeDashboard]);

    /**
     * 🛡️ ฟังก์ชันหลักในการเลือก Item และจัดการข้อมูล GS1
     */
    const handleSelectItem = (selectedItem, barcodeData = null) => {
        setSearch(selectedItem.itemId);
        setItem(selectedItem);
        setShowAuto(false);

        if (isRec) {
            // --- ฝั่งรับเข้า (Receive) ---
            const autoLot = barcodeData?.lot !== "NEED_MANUAL_INPUT" ? (barcodeData?.lot || "") : "";
            const autoExp = barcodeData?.expDate !== "NEED_MANUAL_INPUT" ? (barcodeData?.expDate || "") : "";

            setForm(f => ({ 
                ...f, 
                lotNo: autoLot || '', 
                expDate: autoExp || '' 
            }));

            if(barcodeData?.barcodeType === "GS1_COMPLIANT") {
                const fields = [];
                if(barcodeData.lot) fields.push("Lot");
                if(barcodeData.expDate) fields.push("วันหมดอายุ");
                showToast(`ดึงข้อมูล ${fields.join(" และ ")} อัตโนมัติ`);
            }
        } else {
            // --- ฝั่งเบิกจ่าย (Dispense) ---
            let matchedLot = '';
            if (selectedItem.lots.length > 0) {
                const lotToFind = barcodeData?.lot !== "NEED_MANUAL_INPUT" ? barcodeData?.lot : null;
                const foundIdx = lotToFind ? selectedItem.lots.findIndex(l => l.lotNo === lotToFind) : -1;
                
                // ถ้าสแกนเจอ Lot ตรงกันให้เลือกอันนั้น ถ้าไม่เจอเลือกอันที่ใกล้หมดอายุที่สุด (Index 0)
                const targetLot = foundIdx >= 0 ? selectedItem.lots[foundIdx] : selectedItem.lots[0];
                matchedLot = `${targetLot.rowIndex}|${targetLot.lotNo}`;
                
                if(foundIdx >= 0) showToast("เลือก Lot อัตโนมัติที่ตรงกับบาร์โค้ด");
                else if (lotToFind) showToast(`ไม่พบ Lot ${lotToFind} ในคลัง ระบบเลือก Lot ที่ใกล้หมดอายุให้แทน`, "info");
            }
            setForm(f => ({ ...f, lotNo: matchedLot }));
        }
    };

    const fetchItem = async (qrOrSearch) => {
        if (!qrOrSearch) return;
        
        const barcodeData = processAnyBarcode(qrOrSearch);
        const searchKey = barcodeData?.gtin || qrOrSearch;
        
        // 1. ตรวจสอบใน Local Data ก่อนเพื่อความเร็ว (Dynamic)
        const localMatch = activeDashboard.find(i => 
            (i.itemId||'').toLowerCase() === searchKey.toLowerCase() || 
            (i.qrCode||'').toLowerCase() === searchKey.toLowerCase()
        );

        if (localMatch) {
            handleSelectItem(localMatch, barcodeData);
            return;
        }

        // 2. หากไม่พบใน Local ค่อยเรียก Server
        const res = await gasRun('getReagentWithLots', searchKey);
        setShowAuto(false);
        
        if (res.success) {
            handleSelectItem(res.data, barcodeData);
        } else { 
            showToast(res.message, "error"); 
            setItem(null); 
        }
    };

    const genAutoLot = () => {
        const now = new Date();
        const d = now.getFullYear().toString().substr(-2) + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0');
        setForm(f => ({...f, lotNo: "LOT-" + d}));
    };

    const handleAddCart = (e) => {
        e.preventDefault();
        if(!item) return;
        
        let qVal = parseInt(form.qty, 10);
        if(isNaN(qVal) || qVal <= 0) return showToast("จำนวนไม่ถูกต้อง", "error");
        
        let cartItem = { itemId: item.itemId, name: item.name, qty: qVal, unit: item.unit };
        
        if (isRec) {
            cartItem = { ...cartItem, lotNo: form.lotNo || '-', expDate: form.expDate || '-' };
            const exist = cart.findIndex(i => i.itemId === item.itemId && i.lotNo === form.lotNo);
            if (exist >= 0) { const newCart = [...cart]; newCart[exist].qty += cartItem.qty; setCart(newCart); } else setCart([...cart, cartItem]);
        } else {
            if(!form.lotNo) return showToast("กรุณาเลือก Lot", "error");
            const [rIdx, lNo] = form.lotNo.split('|');
            cartItem = { ...cartItem, rowIndex: rIdx, lotNo: lNo };
            
            const stockItem = item.lots.find(l => l.rowIndex == rIdx);
            const currentInCart = cart.filter(c => c.rowIndex == rIdx).reduce((s,c)=>s+c.qty, 0);
            if (stockItem && (currentInCart + cartItem.qty) > stockItem.qty) return showToast("สต๊อกไม่พอให้เบิก", "error");

            const exist = cart.findIndex(i => i.rowIndex === rIdx);
            if (exist >= 0) { const newCart = [...cart]; newCart[exist].qty += cartItem.qty; setCart(newCart); } else setCart([...cart, cartItem]);
        }
        
        setForm({ lotNo: '', expDate: '', qty: '' }); setItem(null); setSearch(""); showToast("เพิ่มลงตะกร้าแล้ว");
    };

    const updateCartQty = (idx, newQty) => {
        const nQty = parseInt(newQty, 10);
        if (isNaN(nQty) || nQty <= 0) return;

        const newCart = [...cart];
        const target = newCart[idx];

        if (!isRec) {
            const masterItem = activeDashboard.find(i => i.itemId === target.itemId);
            const lotInfo = masterItem?.lots.find(l => l.rowIndex == target.rowIndex);
            if (lotInfo && nQty > lotInfo.qty) {
                showToast(`สต๊อกมีเพียง ${lotInfo.qty}`, "error");
                return;
            }
        }

        newCart[idx].qty = nQty;
        setCart(newCart);
    };

    const submitBatch = async () => {
        if (cart.length === 0) return;
        showToast("กำลังบันทึก...");
        const method = isRec ? 'receiveBatch' : 'dispenseBatch';
        const res = await gasRun(method, cart);
        showToast(res.message, res.success ? 'success' : 'error');
        if (res.success) {
            if (onSuccess) onSuccess(cart);
            setCart([]);
        }
    };

    return (
        <div className="max-w-xl mx-auto space-y-6 animate-slide-up pb-32">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden">
                <div className={`absolute top-0 right-0 w-24 h-24 -mr-8 -mt-8 rounded-full opacity-5 ${isRec ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <div className="flex items-center gap-3 mb-6 relative z-10">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isRec ? 'bg-green-50' : 'bg-red-50'}`}><i className={`fa-solid ${icon} text-2xl`}></i></div>
                    <div><h2 className="text-xl font-bold text-slate-800">{title}</h2><p className="text-xs text-slate-400">สแกนหรือค้นหาเพื่อทำรายการ</p></div>
                </div>
                
                {scanMode ? <QRScanner onScan={(t) => { setScanMode(false); fetchItem(t); }} onCancel={() => setScanMode(false)} /> : 
                    <button onClick={() => setScanMode(true)} className="hidden md:flex w-full mb-6 bg-slate-900 text-white py-3.5 rounded-xl font-medium items-center justify-center active-scale transition shadow-lg shadow-slate-200"><i className="fa-solid fa-camera mr-2"></i>เปิดกล้องสแกน Barcode</button>
                }

                {!scanMode && (
                    <button 
                        onClick={() => setScanMode(true)} 
                        className="md:hidden fixed bottom-24 right-6 w-14 h-14 bg-slate-900 text-white rounded-full shadow-2xl z-50 flex items-center justify-center active-scale transition-transform"
                    >
                        <i className="fa-solid fa-barcode text-xl"></i>
                    </button>
                )}

                <form onSubmit={handleAddCart} className="space-y-4 relative z-10">
                    <div className="relative">
                        <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">ค้นหาด้วยการพิมพ์</label>
                        <div className="flex gap-2 relative">
                            <input type="text" value={search} onFocus={()=>setShowAuto(true)} onBlur={()=>setTimeout(()=>setShowAuto(false), 200)} onChange={e=>{setSearch(e.target.value); setShowAuto(true);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();fetchItem(search);}}} placeholder="ชื่อ รหัส หรือ Barcode..." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-sm focus:ring-2 focus:ring-blue-500 transition outline-none" />
                            <button type="button" onClick={()=>fetchItem(search)} className="w-14 bg-blue-50 text-blue-600 rounded-xl active-scale transition"><i className="fa-solid fa-magnifying-glass"></i></button>
                        </div>
                        
                        {/* 📋 Dynamic Search Results Dropdown */}
                        {showAuto && autoList.length > 0 && !item && (
                            <div className="absolute z-50 w-full bg-white border border-slate-100 rounded-xl shadow-2xl overflow-hidden mt-2 max-h-80 overflow-y-auto animate-slide-up">
                                {autoList.map(a => (
                                    <div 
                                        key={a.itemId} 
                                        onMouseDown={e=>{e.preventDefault(); handleSelectItem(a);}} 
                                        className="p-4 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-0 transition flex justify-between items-center"
                                    >
                                        <div className="overflow-hidden pr-2">
                                            <div className="font-bold text-blue-700 truncate">{highlightText(a.name, search)}</div>
                                            <div className="text-[10px] text-slate-500 mt-1">
                                                {highlightText(a.itemId, search)} | {highlightText(a.qrCode || '-', search)}
                                            </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className={`font-bold text-sm ${a.quantity <= a.minThreshold ? 'text-red-500' : 'text-slate-700'}`}>
                                                {a.quantity}
                                            </div>
                                            <div className="text-[8px] text-slate-400 uppercase tracking-tighter">{a.unit}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {item && (
                        <div className="bg-blue-50/30 border border-blue-100 p-4 sm:p-5 rounded-2xl space-y-4 animate-fade-in mt-4">
                            <div className="flex justify-between items-start border-b border-blue-100/50 pb-3">
                                <div>
                                    <div className="font-bold text-blue-800 text-lg leading-tight">{item.name}</div>
                                    <div className="text-xs text-blue-500 font-mono mt-1">ID: {item.itemId}</div>
                                </div>
                                <button type="button" onClick={() => setItem(null)} className="text-blue-400 hover:text-blue-600 p-1"><i className="fa-solid fa-xmark"></i></button>
                            </div>
                            
                            {isRec ? (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="relative">
                                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Lot No.</label>
                                        <input type="text" required value={form.lotNo} onChange={e=>setForm({...form, lotNo:e.target.value})} className="w-full border-none bg-white rounded-xl px-3 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"/>
                                        <button type="button" onClick={genAutoLot} className="absolute right-2 top-8 text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200">Auto</button>
                                    </div>
                                    <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">EXP Date</label><input type="date" required value={form.expDate} onChange={e=>setForm({...form, expDate:e.target.value})} className="w-full border-none bg-white rounded-xl px-3 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"/></div>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">เลือก Lot (เรียงตาม EXP)</label>
                                    {item.lots.length === 0 ? <div className="text-red-500 text-sm font-bold p-4 bg-red-50 rounded-xl border border-red-100 text-center flex flex-col items-center gap-2">
                                        <i className="fa-solid fa-circle-exclamation text-xl"></i>
                                        <span>สต๊อกหลักหมด - ไม่สามารถเบิกได้</span>
                                    </div> :
                                        <select required value={form.lotNo} onChange={e=>setForm({...form, lotNo:e.target.value})} className="w-full border-none rounded-xl px-3 py-3 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                                            {item.lots.map(l => {
                                                const exp = new Date(l.expDate).toLocaleDateString('th-TH');
                                                return <option key={l.rowIndex} value={`${l.rowIndex}|${l.lotNo}`}>Lot: {l.lotNo} (EXP: {exp}) | มี {l.qty}</option>
                                            })}
                                        </select>
                                    }
                                </div>
                            )}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">จำนวน <span className="normal-case font-medium">({item.unit} - ระบุจำนวนเต็ม)</span></label>
                                <input type="number" step="1" min="1" required value={form.qty} onChange={e=>setForm({...form, qty:e.target.value.replace(/[^0-9]/g, '')})} placeholder={`ระบุจำนวนเต็ม`} className="w-full border-none bg-white rounded-xl px-4 py-3 font-bold text-lg text-slate-800 text-center focus:ring-2 focus:ring-blue-500 outline-none"/>
                            </div>
                            <button type="submit" disabled={!isRec && item.lots.length===0} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold active-scale shadow-lg shadow-blue-100 transition disabled:opacity-50">เพิ่มลงรายการ</button>
                        </div>
                    )}
                </form>
            </div>

            {cart.length > 0 && (
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 animate-slide-up">
                    <h3 className="font-bold text-slate-800 mb-4 flex justify-between items-center px-1">ตะกร้าทำรายการ <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">{cart.length} รายการ</span></h3>
                    <div className="space-y-2 mb-6">
                        {cart.map((c, i) => (
                            <div key={i} className="flex justify-between items-center p-3 sm:p-4 bg-slate-50 border border-slate-100 rounded-xl animate-fade-in">
                                <div className="overflow-hidden pr-2 flex-1">
                                    <div className="font-bold text-slate-700 text-sm truncate">{c.name}</div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">{c.itemId} <span className="mx-1">•</span> Lot: {c.lotNo}</div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <div className="relative">
                                        <input 
                                            type="number" 
                                            value={c.qty} 
                                            onChange={(e) => updateCartQty(i, e.target.value)}
                                            className={`w-16 sm:w-20 text-center font-bold text-sm sm:text-base py-1 px-1 rounded-lg border-2 bg-white outline-none focus:border-blue-400 transition-colors ${!isRec ? 'text-red-600 border-red-100' : 'text-green-600 border-green-100'}`}
                                        />
                                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-100 px-1 rounded text-[8px] font-bold text-slate-400 uppercase tracking-tighter whitespace-nowrap">จำนวน ({c.unit})</div>
                                    </div>
                                    <button onClick={()=>setCart(cart.filter((_,idx)=>idx!==i))} className="w-9 h-9 flex justify-center items-center bg-white text-slate-400 hover:text-red-500 rounded-xl border border-slate-200 shadow-sm active-scale transition"><i className="fa-solid fa-trash-can text-xs"></i></button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button onClick={submitBatch} className={`w-full text-white py-4 rounded-xl font-bold active-scale shadow-lg transition ${btnColor}`}>ยืนยันการบันทึกทั้งหมด</button>
                </div>
            )}
        </div>
    );
};

export default TransactionTab;
