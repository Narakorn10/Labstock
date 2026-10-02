'use client';

import { useState } from 'react';

export type QrField = 'item' | 'lot' | 'exp';

const FIELD_STYLES: Record<QrField, { label: string; chip: string; button: string }> = {
  item: { label: 'รหัสสินค้า', chip: 'border-green-300 bg-green-100 text-green-800', button: 'bg-green-600 hover:bg-green-700' },
  lot: { label: 'Lot', chip: 'border-purple-300 bg-purple-100 text-purple-800', button: 'bg-purple-600 hover:bg-purple-700' },
  exp: { label: 'วันหมดอายุ', chip: 'border-orange-300 bg-orange-100 text-orange-800', button: 'bg-orange-600 hover:bg-orange-700' },
};

/** Show invisible QR characters (GS separators, spaces) as visible marks. */
function displayChar(char: string) {
  if (char === ' ') return '␣';
  const code = char.charCodeAt(0);
  return code < 32 || code === 127 ? '·' : char;
}

/** Return where `value` sits in `raw`, matching how the server learns positions (first occurrence). */
function rangeOf(raw: string, value?: string): [number, number] | null {
  if (!value) return null;
  const start = raw.indexOf(value);
  return start < 0 ? null : [start, start + value.length - 1];
}

/**
 * Lets a user tap the first and last character of a value inside a raw QR
 * string, then label it, instead of retyping Lot/Expiry by hand.
 */
export default function QrCharPicker({
  raw,
  fields,
  values,
  onPick,
}: {
  raw: string;
  fields: QrField[];
  values: Partial<Record<QrField, string>>;
  onPick: (field: QrField, value: string) => void;
}) {
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [warning, setWarning] = useState('');
  const ranges = fields.map((field) => ({ field, range: rangeOf(raw, values[field]) }));

  const tap = (index: number) => {
    setWarning('');
    if (!selection || selection.start !== selection.end) {
      setSelection({ start: index, end: index });
      return;
    }
    setSelection({ start: Math.min(selection.start, index), end: Math.max(selection.start, index) });
  };

  const apply = (field: QrField) => {
    if (!selection) return;
    const value = raw.slice(selection.start, selection.end + 1);
    // The server learns the first place a value appears; warn when the tapped one is a later copy.
    setWarning(raw.indexOf(value) !== selection.start ? `"${value}" ซ้ำกับส่วนที่อยู่ก่อนหน้าใน QR ระบบจะใช้ตำแหน่งแรกที่เจอ ลองเลือกให้ยาวขึ้นอีกนิด` : '');
    onPick(field, value);
    setSelection(null);
  };

  const selected = selection ? raw.slice(selection.start, selection.end + 1) : '';

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-bold text-slate-700">แตะตัวอักษรแรก แล้วแตะตัวอักษรสุดท้ายของค่าที่ต้องการ</p>
      <div className="flex flex-wrap gap-1 font-mono text-sm select-none" aria-label="ตัวอักษรใน QR">
        {raw.split('').map((char, index) => {
          const inSelection = selection && index >= selection.start && index <= selection.end;
          const owner = ranges.find(({ range }) => range && index >= range[0] && index <= range[1]);
          const style = inSelection
            ? 'border-gray-900 bg-gray-900 text-white'
            : owner ? FIELD_STYLES[owner.field].chip : 'border-slate-200 bg-white text-slate-600';
          return (
            <button
              type="button"
              key={index}
              onClick={() => tap(index)}
              className={`flex h-9 min-w-7 items-center justify-center rounded border px-1 ${style}`}
              aria-label={`ตัวที่ ${index + 1}: ${displayChar(char)}`}
            >
              {displayChar(char)}
            </button>
          );
        })}
      </div>
      <div className="min-h-6 text-sm text-slate-600">
        {selected ? <>เลือกอยู่: <span className="rounded bg-white px-2 py-0.5 font-mono font-bold text-slate-900">{selected}</span></> : 'ยังไม่ได้เลือก'}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))` }}>
        {fields.map((field) => (
          <button
            type="button"
            key={field}
            onClick={() => apply(field)}
            disabled={!selection}
            className={`min-h-11 rounded-xl px-2 text-sm font-bold text-white disabled:opacity-30 ${FIELD_STYLES[field].button}`}
          >
            เป็น{FIELD_STYLES[field].label}
          </button>
        ))}
      </div>
      {warning && <p className="text-xs font-semibold text-amber-700">{warning}</p>}
    </div>
  );
}
