import React, { useState, useEffect, useRef } from 'react';

const Select2 = ({ label, options, selected, onChange, placeholder = "เลือกรายการ..." }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const wrapperRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setIsOpen(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const toggleOption = (val) => {
        if (val === 'ALL') {
            onChange(['ALL']);
        } else {
            let newSel = selected.includes(val) 
                ? selected.filter(v => v !== val) 
                : [...selected.filter(v => v !== 'ALL'), val];
            if (newSel.length === 0) newSel = ['ALL'];
            onChange(newSel);
        }
    };

    const filteredOptions = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
    const isAllSelected = selected.includes('ALL');

    return (
        <div className="relative w-full" ref={wrapperRef}>
            <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">{label}</label>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className={`min-h-[48px] px-3 py-2 bg-white border ${isOpen ? 'border-blue-500 ring-4 ring-blue-50' : 'border-slate-200'} rounded-xl cursor-pointer transition-all duration-200 flex flex-wrap items-center gap-2 shadow-sm`}
            >
                {isAllSelected ? (
                    <span className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-[11px] font-bold shadow-sm flex items-center gap-1">
                        <i className="fa-solid fa-check-double text-[9px]"></i> ทั้งหมด
                    </span>
                ) : (
                    selected.map(s => (
                        <span key={s} className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[11px] font-bold border border-slate-200 flex items-center gap-1.5 hover:bg-slate-200 transition">
                            {s}
                            <i onClick={(e) => { e.stopPropagation(); toggleOption(s); }} className="fa-solid fa-xmark text-slate-400 hover:text-red-500 transition-colors text-[10px]"></i>
                        </span>
                    ))
                )}
                {!isOpen && selected.length === 0 && <span className="text-slate-400 text-sm ml-1">{placeholder}</span>}
                <div className="ml-auto pl-2 text-slate-400">
                    <i className={`fa-solid fa-chevron-down text-[10px] transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}></i>
                </div>
            </div>

            {isOpen && (
                <div className="absolute z-50 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl overflow-hidden animate-slide-up origin-top">
                    <div className="p-3 border-b border-slate-50 bg-slate-50/50">
                        <div className="relative">
                            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                            <input autoFocus type="text" className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none" placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} onClick={e => e.stopPropagation()} />
                        </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto hide-scroll p-1">
                        <div onClick={() => { toggleOption('ALL'); setIsOpen(false); }} className={`mx-1 px-4 py-3 text-sm rounded-lg cursor-pointer transition flex items-center justify-between ${isAllSelected ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <div className="flex items-center gap-2">
                                <div className={`w-4 h-4 rounded border flex items-center justify-center transition ${isAllSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'}`}>
                                    {isAllSelected && <i className="fa-solid fa-check text-[10px] text-white"></i>}
                                </div>
                                <span>ทั้งหมด (ทุกประเภท)</span>
                            </div>
                        </div>
                        {filteredOptions.map(o => {
                            const isSelected = selected.includes(o);
                            return (
                                <div key={o} onClick={() => toggleOption(o)} className={`mx-1 px-4 py-3 text-sm rounded-lg cursor-pointer transition flex items-center justify-between ${isSelected ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'}`}>
                                            {isSelected && <i className="fa-solid fa-check text-[10px] text-white"></i>}
                                        </div>
                                        <span>{o}</span>
                                    </div>
                                </div>
                            );
                        })}
                        {filteredOptions.length === 0 && (
                            <div className="px-4 py-8 text-center">
                                <i className="fa-solid fa-face-frown text-slate-300 text-2xl mb-2"></i>
                                <p className="text-xs text-slate-400">ไม่พบข้อมูลที่ค้นหา</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Select2;
