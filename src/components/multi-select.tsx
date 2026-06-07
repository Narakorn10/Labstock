'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Check, X, CheckCircle2 } from 'lucide-react';

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

export default function MultiSelect({ 
  label, 
  options, 
  selected, 
  onChange, 
  placeholder = "เลือกรายการ..." 
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (val: string) => {
    if (val === 'ALL') {
      onChange(['ALL']);
      setIsOpen(false);
    } else {
      let newSel = selected.includes(val)
        ? selected.filter(v => v !== val)
        : [...selected.filter(v => v !== 'ALL'), val];
      
      if (newSel.length === 0) newSel = ['ALL'];
      onChange(newSel);
    }
  };

  const filteredOptions = options.filter(o => 
    o.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const isAllSelected = selected.includes('ALL');

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <label className="block text-[11px] font-black text-gray-400 mb-2 uppercase tracking-widest ml-1">
        {label}
      </label>
      
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className={`
          min-h-[56px] px-4 py-2 bg-white border rounded-[1.2rem] cursor-pointer transition-all duration-300 flex flex-wrap items-center gap-2 shadow-sm
          ${isOpen ? 'border-blue-500 ring-4 ring-blue-50' : 'border-gray-100 hover:border-gray-200'}
        `}
      >
        {isAllSelected ? (
          <span className="px-3 py-1 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 shadow-md shadow-blue-100">
            <CheckCircle2 size={12} /> ทั้งหมด
          </span>
        ) : (
          selected.map(s => (
            <span 
              key={s} 
              className="px-3 py-1 bg-gray-50 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest border border-gray-100 flex items-center gap-1.5 hover:bg-gray-100 transition-colors"
            >
              {s}
              <X 
                size={12} 
                className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer" 
                onClick={(e) => { e.stopPropagation(); toggleOption(s); }}
              />
            </span>
          ))
        )}
        
        {selected.length === 0 && !isOpen && (
          <span className="text-gray-400 text-sm ml-1 font-bold">{placeholder}</span>
        )}
        
        <div className="ml-auto pl-2 text-gray-300">
          <ChevronDown 
            size={18} 
            className={`transition-transform duration-300 ${isOpen ? 'rotate-180 text-blue-500' : ''}`} 
          />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-[60] w-full mt-3 bg-white border border-gray-100 rounded-[2rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300 origin-top">
          {/* Search Area */}
          <div className="p-4 border-b border-gray-50 bg-gray-50/50">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input 
                autoFocus 
                type="text" 
                className="w-full bg-white border border-gray-100 rounded-xl pl-10 pr-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                placeholder="ค้นหา..." 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)} 
                onClick={e => e.stopPropagation()} 
              />
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-72 overflow-y-auto no-scrollbar p-2 space-y-1">
            <div 
              onClick={() => toggleOption('ALL')} 
              className={`
                px-4 py-4 text-sm rounded-2xl cursor-pointer transition-all flex items-center justify-between
                ${isAllSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}
              `}
            >
              <div className="flex items-center gap-3">
                <div className={`
                  w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all
                  ${isAllSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-200'}
                `}>
                  {isAllSelected && <Check size={14} className="text-white stroke-[3px]" />}
                </div>
                <span className={`font-black uppercase tracking-tight ${isAllSelected ? 'text-blue-700' : 'text-gray-600'}`}>ทั้งหมด (ทุกประเภท)</span>
              </div>
            </div>

            {filteredOptions.map(o => {
              const isSelected = selected.includes(o);
              return (
                <div 
                  key={o} 
                  onClick={() => toggleOption(o)} 
                  className={`
                    px-4 py-4 text-sm rounded-2xl cursor-pointer transition-all flex items-center justify-between
                    ${isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div className={`
                      w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all
                      ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-200'}
                    `}>
                      {isSelected && <Check size={14} className="text-white stroke-[3px]" />}
                    </div>
                    <span className={`font-bold ${isSelected ? 'text-blue-700' : 'text-gray-600'}`}>{o}</span>
                  </div>
                </div>
              );
            })}

            {filteredOptions.length === 0 && (
              <div className="py-12 text-center text-gray-300">
                <Search size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-xs font-black uppercase tracking-widest">ไม่พบข้อมูล</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
