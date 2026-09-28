'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import type { Reagent } from '@/lib/api-client';
import { getMobileFocusStats, toLocalDateString } from '@/lib/mobile-focus-stats';
import { formatThaiDate } from '@/lib/thai-date';

const WATCH_LIMIT = 5;

export default function MobileHome() {
  const [reagents, setReagents] = useState<Reagent[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/mobile/lookup')
      .then(async (response) => {
        const data = await response.json() as { reagents?: Reagent[] };
        if (!response.ok || !data.reagents) throw new Error('lookup failed');
        if (!cancelled) setReagents(data.reagents);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(
    () => (reagents ? getMobileFocusStats(reagents, toLocalDateString(new Date())) : null),
    [reagents],
  );

  const focusTiles = [
    { value: stats?.expiredLots, label: 'lot หมดอายุ' },
    { value: stats?.belowMin, label: 'ต่ำกว่า Min' },
    { value: stats?.nearExpiryLots, label: 'ใกล้หมดอายุ' },
  ];
  const watchList = stats?.watchList.slice(0, WATCH_LIMIT) ?? [];
  const hiddenWatchCount = (stats?.watchList.length ?? 0) - watchList.length;

  return (
    <div className="min-h-screen bg-ground text-ink">
      <div className="mx-auto flex max-w-md flex-col gap-3.5 px-[18px] pb-8 pt-5">
        <header className="flex items-center gap-3">
          <Image src="/images/logo-spr-lab.png" alt="โลโก้ SPR LAB" width={44} height={44} priority className="size-11 rounded-xl" />
          <div>
            <p className="text-xs text-ink-muted">SPR LAB · งานโลหิตวิทยา</p>
            <h1 className="text-xl font-semibold">LabStock สำหรับมือถือ</h1>
          </div>
        </header>

        <section className="relative overflow-hidden rounded-[20px] bg-[#0a1622] p-[18px] text-white">
          <Image src="/images/labstock-clinical-inventory-hero.png" alt="" fill sizes="480px" className="object-cover object-right" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,22,34,0.92),rgba(10,22,34,0.35))]" />
          <div className="relative">
            <p className="text-xs tracking-[0.14em] text-[#b9cde0]">TODAY&apos;S FOCUS</p>
            <h2 className="mb-3 mt-1 text-[19px] font-semibold">ตรวจสต็อกก่อนเริ่มงาน</h2>
            <div className="grid grid-cols-3 gap-2">
              {focusTiles.map((tile) => (
                <div key={tile.label} className="rounded-xl bg-white/[0.12] px-2.5 py-2">
                  <p className="text-[22px] font-semibold leading-tight">{tile.value ?? '–'}</p>
                  <p className="text-[11px] text-[#d7e2ec]">{tile.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Link href="/mobile/receive" className="flex min-h-[150px] flex-col justify-between rounded-[20px] bg-ink px-4 py-[18px] text-white! active:scale-[0.98]">
            <ArrowDownToLine size={28} strokeWidth={1.5} />
            <div>
              <p className="text-[22px] font-semibold">รับเข้า</p>
              <p className="text-xs text-[#b8bbbf]">สแกน GS1 เพิ่มเข้าคลัง</p>
            </div>
          </Link>
          <Link href="/mobile/dispense" className="flex min-h-[150px] flex-col justify-between rounded-[20px] border border-line bg-white px-4 py-[18px] text-ink! active:scale-[0.98]">
            <ArrowUpFromLine size={28} strokeWidth={1.5} />
            <div>
              <p className="text-[22px] font-semibold">เบิกจ่าย</p>
              <p className="text-xs text-ink-muted">FEFO เลือก lot ให้อัตโนมัติ</p>
            </div>
          </Link>
        </div>

        <section className="rounded-[18px] border border-line bg-white px-3.5 py-1.5">
          <h2 className="py-2.5 font-semibold">ล็อตที่ต้องเฝ้าระวัง</h2>
          {loadFailed && <p className="border-t border-[#ececee] py-3 text-sm text-crit">โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้านี้</p>}
          {!loadFailed && !stats && <p className="border-t border-[#ececee] py-3 text-sm text-ink-muted">กำลังโหลด...</p>}
          {stats && watchList.length === 0 && <p className="border-t border-[#ececee] py-3 text-sm text-ink-muted">ไม่มีล็อตที่หมดอายุหรือใกล้หมดอายุใน 30 วัน</p>}
          {watchList.map((lot) => (
            <div key={`${lot.itemId}-${lot.lotNo}`} className="flex items-center gap-3 border-t border-[#ececee] py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{lot.name}</p>
                <p className="text-xs text-ink-muted">Lot {lot.lotNo} · {formatThaiDate(lot.expDate)}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-[3px] text-xs font-medium ${lot.daysLeft < 0 ? 'bg-crit text-white' : 'bg-warn-bg text-warn'}`}>
                {lot.daysLeft < 0 ? 'หมดอายุ' : `${lot.daysLeft} วัน`}
              </span>
            </div>
          ))}
          {hiddenWatchCount > 0 && <p className="border-t border-[#ececee] py-2.5 text-xs text-ink-muted">และอีก {hiddenWatchCount} ล็อต</p>}
        </section>

        <p className="px-1 text-center text-xs text-ink-muted">
          นับเฉพาะล็อตที่ยังมีของคงเหลือ · ต่ำกว่า Min ตามเกณฑ์เดียวกับหน้าแดชบอร์ด
        </p>
      </div>
    </div>
  );
}
