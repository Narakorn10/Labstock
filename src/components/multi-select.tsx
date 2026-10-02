'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

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
    o && o.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isAllSelected = selected.includes('ALL');

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <label className="mb-1.5 block text-[13px] font-medium text-gray-600">
        {label}
      </label>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex min-h-[38px] cursor-pointer flex-wrap items-center gap-1.5 rounded-[10px] border bg-white px-3 py-1 transition-colors
          ${isOpen ? 'border-gray-400 ring-4 ring-gray-400/10' : 'border-line hover:border-gray-400'}
        `}
      >
        {isAllSelected ? (
          <span className="text-sm text-ink">ทั้งหมด</span>
        ) : (
          selected.map(s => (
            <span
              key={s}
              className="flex items-center gap-1.5 rounded-full border border-line bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800"
            >
              {s}
              <X
                size={12}
                className="cursor-pointer text-gray-600 transition-colors hover:text-crit"
                onClick={(e) => { e.stopPropagation(); toggleOption(s); }}
              />
            </span>
          ))
        )}

        {selected.length === 0 && !isOpen && (
          <span className="text-sm text-gray-500">{placeholder}</span>
        )}

        <div className="ml-auto pl-2 text-gray-600">
          <ChevronDown
            size={16}
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-[60] mt-2 w-full origin-top overflow-hidden rounded-xl border border-line bg-white shadow-lg animate-in fade-in zoom-in-95 duration-150">
          {/* Search Area */}
          <div className="border-b border-line p-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
              <input
                autoFocus
                type="text"
                className="min-h-[38px] w-full rounded-[10px] border border-line bg-white py-[7px] pl-9 pr-3 text-sm outline-none focus:border-gray-400"
                placeholder="ค้นหา..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Options List */}
          <div className="no-scrollbar max-h-72 overflow-y-auto p-1.5">
            <div
              onClick={() => toggleOption('ALL')}
              className={`
                flex cursor-pointer items-center justify-between rounded-[10px] px-3 py-2.5 text-sm transition-colors
                ${isAllSelected ? 'bg-gray-200 font-semibold text-ink' : 'text-gray-800 hover:bg-[#fafafa]'}
              `}
            >
              <div className="flex items-center gap-3">
                <div className={`
                  flex size-[18px] items-center justify-center rounded-md border transition-colors
                  ${isAllSelected ? 'border-ink bg-ink' : 'border-gray-400 bg-white'}
                `}>
                  {isAllSelected && <Check size={12} className="stroke-[3px] text-white" />}
                </div>
                <span>ทั้งหมด (ทุกประเภท)</span>
              </div>
            </div>

            {filteredOptions.map(o => {
              const isSelected = selected.includes(o);
              return (
                <div
                  key={o}
                  onClick={() => toggleOption(o)}
                  className={`
                    flex cursor-pointer items-center justify-between rounded-[10px] px-3 py-2.5 text-sm transition-colors
                    ${isSelected ? 'bg-gray-200 font-semibold text-ink' : 'text-gray-800 hover:bg-[#fafafa]'}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div className={`
                      flex size-[18px] items-center justify-center rounded-md border transition-colors
                      ${isSelected ? 'border-ink bg-ink' : 'border-gray-400 bg-white'}
                    `}>
                      {isSelected && <Check size={12} className="stroke-[3px] text-white" />}
                    </div>
                    <span>{o}</span>
                  </div>
                </div>
              );
            })}

            {filteredOptions.length === 0 && (
              <div className="py-8 text-center text-gray-600">
                <p className="text-sm">ไม่พบข้อมูล</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
