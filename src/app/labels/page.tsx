'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, Printer, QrCode, Search, Trash2 } from 'lucide-react';
import { apiClient, Reagent } from '@/lib/api-client';
import { useAuth } from '@/components/auth-provider';
import { LABEL_HEIGHT_MM, LABEL_WIDTH_MM, LotLabel, LotLabelProps } from '@/components/lot-label';

const MAX_COPIES = 200;

type LotOption = LotLabelProps & { key: string; quantity: number };

function thaiDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '-';
}

/** One row per lot + EXP: the same lot received on several days prints the same sticker. */
function lotOptions(reagent: Reagent): LotOption[] {
  const byKey = new Map<string, LotOption>();
  for (const lot of reagent.lots || []) {
    if (!(Number(lot.qty) > 0)) continue;
    const expDate = String(lot.expDate || '').slice(0, 10);
    const key = `${reagent.itemId}|${lot.lotNo}|${expDate}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity += Number(lot.qty);
    else byKey.set(key, { key, itemId: reagent.itemId, name: reagent.name, lotNo: lot.lotNo, expDate, quantity: Number(lot.qty) });
  }
  return [...byKey.values()].sort((a, b) => (a.expDate || '9999').localeCompare(b.expDate || '9999'));
}

export default function LotLabelsPage() {
  const { user } = useAuth();
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useState<Array<LotOption & { copies: number }>>([]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    apiClient.getDashboard()
      .then((data) => { if (active) setReagents(data); })
      .catch((fetchError) => {
        console.error('Lot labels fetch error:', fetchError);
        if (active) setError('ไม่สามารถโหลดรายการน้ำยาได้');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  const results = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return [];
    return reagents
      .filter((reagent) => [reagent.name, reagent.itemId, reagent.qrCode]
        .some((value) => String(value || '').toLowerCase().includes(keyword)))
      .slice(0, 20)
      .map((reagent) => ({ reagent, lots: lotOptions(reagent) }));
  }, [reagents, search]);

  // The print sheet is portaled to <body> so print CSS can drop the whole app shell (no blank pages).
  const isClient = useSyncExternalStore(() => () => {}, () => true, () => false);

  const totalLabels = queue.reduce((sum, row) => sum + row.copies, 0);

  const addLot = (lot: LotOption) => {
    setQueue((prev) => prev.some((row) => row.key === lot.key)
      ? prev.map((row) => row.key === lot.key ? { ...row, copies: Math.min(MAX_COPIES, row.copies + 1) } : row)
      : [...prev, { ...lot, copies: 1 }]);
  };

  const setCopies = (key: string, value: number) => {
    const copies = Math.max(1, Math.min(MAX_COPIES, Math.floor(value) || 1));
    setQueue((prev) => prev.map((row) => row.key === key ? { ...row, copies } : row));
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="no-print">
        <h1 className="flex items-center gap-2 text-[32px] font-medium leading-tight text-ink">
          <QrCode size={28} strokeWidth={1.5} aria-hidden="true" />ปริ้น QR Lot
        </h1>
        <p className="mt-1.5 text-[15px] text-gray-600">
          สติกเกอร์ความร้อน {LABEL_WIDTH_MM}x{LABEL_HEIGHT_MM} มม. · สแกน QR ในหน้าเบิกจ่าย/รับเข้า ระบบจะเลือกน้ำยาและ Lot ให้อัตโนมัติ
        </p>
      </div>

      {error && <div role="alert" className="no-print flex items-center gap-3 rounded-xl bg-crit-bg px-4 py-3 text-sm font-medium text-crit"><AlertTriangle size={20} />{error}</div>}

      <div className="no-print grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby="pick-heading">
          <h2 id="pick-heading" className="text-xl font-medium">1. เลือก Lot</h2>
          <div className="relative mt-3">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="พิมพ์ชื่อ รหัส หรือบาร์โค้ดน้ำยา"
              aria-label="ค้นหาน้ำยา"
              className="w-full rounded-[10px] border border-line bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-ink"
            />
          </div>
          {loading && <p className="mt-4 flex items-center gap-2 text-sm text-gray-600"><Loader2 className="animate-spin" size={16} />กำลังโหลดรายการน้ำยา...</p>}
          <div className="mt-3 space-y-3">
            {results.map(({ reagent, lots }) => (
              <div key={reagent.itemId} className="rounded-xl border border-line p-3">
                <p className="font-medium">{reagent.name} <span className="text-xs font-normal text-gray-600">{reagent.itemId}</span></p>
                {lots.length === 0 ? <p className="mt-1 text-sm text-gray-600">ไม่มี Lot ที่มีของคงเหลือ</p> : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lots.map((lot) => (
                      <button
                        key={lot.key}
                        type="button"
                        onClick={() => addLot(lot)}
                        className="rounded-[10px] border border-line px-3 py-1.5 text-left text-sm hover:border-ink hover:bg-gray-50"
                      >
                        <span className="font-medium">Lot {lot.lotNo}</span>
                        <span className="block text-xs text-gray-600">EXP {thaiDate(lot.expDate)} · เหลือ {lot.quantity} {reagent.unit}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {search.trim() && !loading && results.length === 0 && <p className="text-sm text-gray-600">ไม่พบน้ำยาที่ตรงกับคำค้น</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby="queue-heading">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="queue-heading" className="mr-auto text-xl font-medium">2. จำนวนดวงที่จะปริ้น</h2>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={totalLabels === 0}
              className="inline-flex items-center gap-2 rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Printer size={16} aria-hidden="true" />ปริ้น {totalLabels} ดวง
            </button>
          </div>
          {queue.length === 0 && <p className="py-8 text-sm text-gray-600">ยังไม่ได้เลือก Lot</p>}
          <ul className="mt-3 space-y-2">
            {queue.map((row) => (
              <li key={row.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
                <div className="mr-auto min-w-0">
                  <p className="truncate font-medium">{row.name}</p>
                  <p className="text-xs text-gray-600">Lot {row.lotNo} · EXP {thaiDate(row.expDate)}</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  จำนวน
                  <input
                    type="number"
                    min={1}
                    max={MAX_COPIES}
                    value={row.copies}
                    onChange={(event) => setCopies(row.key, Number(event.target.value))}
                    className="w-20 rounded-[10px] border border-line px-2 py-1 text-right"
                  />
                  ดวง
                </label>
                <button type="button" onClick={() => setQueue((prev) => prev.filter((item) => item.key !== row.key))} aria-label={`ลบ Lot ${row.lotNo}`} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-crit">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          {queue.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-medium text-gray-700">ตัวอย่างป้าย (ขนาดจริง)</p>
              <div className="flex flex-wrap gap-3">
                {queue.map((row) => (
                  <div key={row.key} className="border border-dashed border-gray-400">
                    <LotLabel itemId={row.itemId} name={row.name} lotNo={row.lotNo} expDate={row.expDate} />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-600">ตอนปริ้น: ตั้งขนาดกระดาษในไดรเวอร์เป็น {LABEL_WIDTH_MM}x{LABEL_HEIGHT_MM} มม., ขอบกระดาษ (Margins) = ไม่มี, Scale = 100%</p>
            </div>
          )}
        </section>
      </div>

      {isClient && createPortal(
        <div className="label-print-area" aria-hidden="true">
          {queue.flatMap((row) => Array.from({ length: row.copies }, (_, index) => (
            <div key={`${row.key}-${index}`} className="label-print-page">
              <LotLabel itemId={row.itemId} name={row.name} lotNo={row.lotNo} expDate={row.expDate} />
            </div>
          )))}
        </div>,
        document.body
      )}

      <style jsx global>{`
        .label-print-area { display: none; }
        @media print {
          @page { size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm; margin: 0; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          body > *:not(.label-print-area) { display: none !important; }
          .label-print-area { display: block; }
          .label-print-page { width: ${LABEL_WIDTH_MM}mm; height: ${LABEL_HEIGHT_MM}mm; overflow: hidden; break-after: page; }
          .label-print-page:last-child { break-after: auto; }
        }
      `}</style>
    </div>
  );
}
