'use client';

import { useState } from 'react';

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the real input. */
  label: string;
  length?: number;
  autoComplete?: string;
  disabled?: boolean;
}

/**
 * Six-cell PIN field. A real password input sits invisibly over the cells, so typing, paste, autofill and the
 * numeric keypad behave normally. Any length up to `length` is accepted because accounts may use 4–6 digit PINs.
 */
export default function PinInput({ value, onChange, label, length = 6, autoComplete = 'current-password', disabled }: PinInputProps) {
  const [focused, setFocused] = useState(false);
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <div className="relative">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }} aria-hidden="true">
        {Array.from({ length }, (_, index) => {
          const filled = index < value.length;
          const active = focused && index === activeIndex;
          return (
            <div
              key={index}
              className={`flex h-[50px] items-center justify-center rounded-xl bg-white text-[22px] text-ink ${
                active ? 'border-2 border-line-green' : filled ? 'border border-ink' : 'border border-line'
              }`}
            >
              {filled ? '•' : ''}
            </div>
          );
        })}
      </div>
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={autoComplete}
        maxLength={length}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-text text-base opacity-0"
      />
    </div>
  );
}
