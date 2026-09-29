'use client';

import { Check, Info, X } from 'lucide-react';
import { formatThaiDate } from '@/lib/thai-date';

export interface LastAddedItem {
  cartId: string;
  name: string;
  lotNo: string;
  expDate: string;
  unit: string;
  /** False when the item was already at the lot's maximum, so nothing was actually added. */
  incremented: boolean;
}

interface ScanResultSheetProps {
  item: LastAddedItem;
  /** Current quantity of this item in the queue. */
  qty: number;
  onUndo: () => void;
  onDismiss: () => void;
  onScanNext: () => void;
}

/** Bottom sheet shown right after an item is added to the queue by scan or search. The item is already in the queue; "เอาออก" undoes it. */
export default function ScanResultSheet({ item, qty, onUndo, onDismiss, onScanNext }: ScanResultSheetProps) {
  const tiles = [
    { label: 'Lot', value: item.lotNo || '-' },
    { label: 'EXP', value: formatThaiDate(item.expDate) },
    { label: 'ในคิว', value: `${qty} ${item.unit}` },
  ];

  return (
    <div role="status" className="fixed inset-x-0 bottom-[98px] z-30 mx-auto max-w-md px-3">
      <div className="space-y-3 rounded-[24px] border border-line bg-white p-4 shadow-[0_12px_32px_rgba(29,31,32,0.22)]">
        <div className="flex items-center gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${item.incremented ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}>
            {item.incremented ? <Check size={20} /> : <Info size={20} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-medium ${item.incremented ? 'text-ok' : 'text-warn'}`}>
              {item.incremented ? 'เพิ่มเข้าคิวแล้ว' : 'ถึงจำนวนสูงสุดของล็อตนี้แล้ว'}
            </p>
            <p className="truncate text-[17px] font-semibold text-ink">{item.name}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="ปิดผลสแกน"
            className="-mr-1.5 -mt-1.5 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-xl bg-[#f6f6f7] px-2.5 py-2">
              <p className="text-[11px] text-ink-muted">{tile.label}</p>
              <p className="truncate text-sm font-semibold text-ink">{tile.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_1.6fr] gap-2.5">
          <button
            type="button"
            onClick={item.incremented ? onUndo : onDismiss}
            className="min-h-[52px] rounded-[14px] border border-line bg-white font-medium text-ink active:scale-[0.98]"
          >
            {item.incremented ? 'เอาออก' : 'ปิด'}
          </button>
          <button
            type="button"
            onClick={onScanNext}
            className="min-h-[52px] rounded-[14px] bg-ink font-medium text-white active:scale-[0.98]"
          >
            สแกนต่อ
          </button>
        </div>
      </div>
    </div>
  );
}
