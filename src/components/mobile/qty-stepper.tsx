'use client';

import { Minus, Plus } from 'lucide-react';

interface QtyStepperProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  /** When set, the plus button is disabled at this value. Callers still cap typed values. */
  max?: number;
  /** Stretch to the full width with a shaded value box (LIFF layout) instead of the compact inline control. */
  wide?: boolean;
}

/** Mobile quantity control with 44px hit targets. Typing a number is still allowed for large receive quantities. */
export default function QtyStepper({ value, onChange, label, min = 1, max, wide = false }: QtyStepperProps) {
  const atMax = max !== undefined && value >= max;
  const atMin = value <= min;

  return (
    <div className={wide ? 'grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2' : 'flex items-center gap-2'}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={atMin}
        aria-label={`${label} ลดลง 1`}
        className="flex size-11 items-center justify-center rounded-xl border border-line bg-white text-ink transition active:scale-95 disabled:text-[#b8bbbf]"
      >
        <Minus size={18} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        onChange={(event) => onChange(parseInt(event.target.value, 10) || 0)}
        aria-label={label}
        className={`h-11 rounded-xl text-center text-xl font-semibold text-ink outline-none focus:bg-white focus:ring-2 focus:ring-ink/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
          wide ? 'w-full bg-[#f6f6f7] text-lg' : 'w-14 bg-transparent'
        }`}
      />
      <button
        type="button"
        onClick={() => onChange(atMax ? value : value + 1)}
        disabled={atMax}
        aria-label={`${label} เพิ่มขึ้น 1`}
        className="flex size-11 items-center justify-center rounded-xl border border-ink bg-ink text-white transition active:scale-95 disabled:border-line disabled:bg-white disabled:text-[#b8bbbf]"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
