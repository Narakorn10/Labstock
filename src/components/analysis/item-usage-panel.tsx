'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { AlertTriangle, Loader2, Search } from 'lucide-react';
import { apiClient, ItemUsageDetail, ReorderStatus } from '@/lib/api-client';
import { toLocalIsoDate } from '@/lib/local-date';

type ItemOption = { itemId: string; name: string };

const statusMeta: Record<ReorderStatus, { label: string; badge: string }> = {
  normal: { label: 'ปกติ', badge: 'bg-ok-bg text-ok' },
  reorder: { label: 'ควรสั่ง', badge: 'bg-warn-bg text-warn' },
  critical: { label: 'วิกฤต', badge: 'bg-crit-bg text-crit' }
};

const cardClass = 'rounded-2xl border border-line bg-white p-5';
const axisTick = { fontSize: 12, fill: '#6b6e72' };
const thClass = 'bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600';
const tdClass = 'border-b border-line px-3.5 py-2.5 text-sm';

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits }).format(value);
}

export const REGULAR_COLOR = 'var(--accent)';
export const REFILL_COLOR = 'var(--ok)';
const AVERAGE_COLOR = 'var(--warn)';

export type UsageRow = { date: string; regular: number; refill: number; total: number; average7Days: number | null };

/**
 * One row per day from startDate to endDate (days without usage are 0) with the 7-day moving average of the total.
 * From the latest count day on the refill is not known yet, so the average line stops there (average7Days is null).
 */
export function buildUsageRows(
  startDate: string,
  endDate: string,
  pick: (date: string) => { regular: number; refill: number },
  lastCountDate?: string | null
): UsageRow[] {
  const rows: UsageRow[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    const date = toLocalIsoDate(cursor);
    const { regular, refill } = pick(date);
    const total = regular + refill;
    const recent = [...rows.slice(-6).map((row) => row.total), total];
    const refillKnown = !lastCountDate || date < lastCountDate;
    rows.push({ date, regular, refill, total, average7Days: refillKnown ? recent.reduce((sum, value) => sum + value, 0) / recent.length : null });
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const shortThaiDate = (date: string) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00`));

type TooltipPayload = { payload?: Record<string, number | string> };

/** Tooltip that shows the regular dispense, the refill and the total of the hovered bar. */
export function UsageTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string | number }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const title = typeof row.name === 'string' ? row.name : typeof label === 'string' && DATE_KEY.test(label) ? shortThaiDate(label) : String(label ?? '');
  const regular = Number(row.regular ?? row.dispensed) || 0;
  const refill = Number(row.refill) || 0;
  return (
    <div className="rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] shadow-sm">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-gray-700"><span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: REGULAR_COLOR }} aria-hidden="true" />เบิกไปหน้างาน {formatNumber(regular, 2)}</p>
      <p className="text-gray-700"><span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: REFILL_COLOR }} aria-hidden="true" />เบิกเติม {formatNumber(refill, 2)}</p>
      <p className="mt-1 font-semibold text-ink">รวม {formatNumber(regular + refill, 2)}</p>
      {typeof row.average7Days === 'number' && <p className="text-xs text-gray-600">เฉลี่ย 7 วัน {formatNumber(row.average7Days, 2)}</p>}
    </div>
  );
}

/** Stacked daily bars (regular + refill) with the 7-day average line; days from the latest count on are shaded. */
export function DailyUsageChart({ rows, lastCountDate }: { rows: UsageRow[]; lastCountDate?: string | null }) {
  const shadeFrom = lastCountDate ? rows.find((row) => row.date >= lastCountDate)?.date : undefined;
  const shadeTo = rows.length ? rows[rows.length - 1].date : undefined;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ left: 0, right: 8 }}>
        <CartesianGrid stroke="#dcdcdf" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortThaiDate} minTickGap={60} tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis hide />
        <Tooltip content={<UsageTooltip />} />
        {shadeFrom && shadeTo && shadeFrom !== shadeTo && (
          <ReferenceArea x1={shadeFrom} x2={shadeTo} fill="var(--line)" fillOpacity={0.5} stroke="none" ifOverflow="hidden" />
        )}
        <Bar dataKey="regular" name="เบิกไปหน้างาน" stackId="usage" fill={REGULAR_COLOR} />
        <Bar dataKey="refill" name="เบิกเติม" stackId="usage" fill={REFILL_COLOR} />
        <Line type="linear" dataKey="average7Days" name="เฉลี่ย 7 วัน" stroke={AVERAGE_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Colour key and the two notes that explain how the refill is spread. Used under every chart that stacks refill. */
export function UsageLegend({ shaded }: { shaded: boolean }) {
  return (
    <div className="mt-2 space-y-1 text-xs text-gray-600">
      <div className="flex flex-wrap items-center gap-4 text-[13px]">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: REGULAR_COLOR }} aria-hidden="true" />เบิกไปหน้างาน</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: REFILL_COLOR }} aria-hidden="true" />เบิกเติมจากใบงานนับสต็อก</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: AVERAGE_COLOR }} aria-hidden="true" />เฉลี่ย 7 วัน (รวมทั้งสอง)</span>
      </div>
      <p>ยอดเบิกเติมถูกกระจายย้อนไปในช่วงระหว่างวันนับครั้งก่อนถึงวันก่อนวันนับครั้งนี้ (นับครั้งแรกกระจาย 7 วัน){shaded ? ' ช่วงที่แรเงาคือตั้งแต่วันนับล่าสุดเป็นต้นไป จึงยังไม่มียอดเบิกเติม และจะเพิ่มเมื่อนับครั้งถัดไป เส้นเฉลี่ยและค่าเฉลี่ยต่อวันจึงนับถึงวันก่อนวันนับล่าสุดเท่านั้น' : ''}</p>
      <p>ถ้าเปลี่ยนค่า Max (เป้าสัปดาห์) ระหว่างรอบนับ ยอดเบิกเติมของรอบนั้นอาจคลาดเคลื่อนเล็กน้อย</p>
    </div>
  );
}

/** Shown when the server could not read the refill from the count work orders (refillUnavailable). */
export function RefillUnavailableNotice() {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
      <AlertTriangle size={20} aria-hidden="true" />
      ยอดเบิกเติมจากใบงานนับยังโหลดไม่ได้ ตัวเลขตอนนี้เป็นเฉพาะเบิกไปหน้างาน
    </div>
  );
}

function thaiDate(value: string) {
  if (!value) return '-';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ItemUsagePanel({
  items,
  selectedItemId,
  onSelectItem,
  startDate,
  endDate
}: {
  items: ItemOption[];
  selectedItemId: string | null;
  onSelectItem: (itemId: string) => void;
  startDate: string;
  endDate: string;
}) {
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ItemUsageDetail | null>(null);
  // Key of the last finished request; loading is derived instead of set inside the effect.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const requestKey = selectedItemId ? `${selectedItemId}|${startDate}|${endDate}` : null;
  const loading = requestKey !== null && settled?.key !== requestKey;
  const error = settled?.key === requestKey ? settled.error : null;

  useEffect(() => {
    if (!selectedItemId || !requestKey) return;
    let cancelled = false;
    apiClient.getItemUsage(selectedItemId, startDate, endDate)
      .then((response) => {
        if (cancelled) return;
        setDetail(response);
        setSettled({ key: requestKey, error: null });
      })
      .catch((fetchError) => {
        console.error('Item Usage Fetch Error:', fetchError);
        if (!cancelled) setSettled({ key: requestKey, error: 'ไม่สามารถดึงข้อมูลการใช้ของน้ำยานี้ได้' });
      });
    return () => { cancelled = true; };
  }, [requestKey, selectedItemId, startDate, endDate]);

  const matches = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return [];
    return items
      .filter((item) => item.name.toLowerCase().includes(keyword) || item.itemId.toLowerCase().includes(keyword))
      .slice(0, 12);
  }, [items, search]);

  // Fill days without usage with 0 so the bars and the average line are continuous.
  const dailyTrend = useMemo(() => {
    if (!detail) return [];
    const byDate = new Map(detail.daily.map((row) => [row.date, row]));
    return buildUsageRows(detail.range.startDate, detail.range.endDate, (date) => ({
      regular: byDate.get(date)?.regular ?? 0,
      refill: byDate.get(date)?.refill ?? 0
    }), detail.lastCountDate);
  }, [detail]);

  const monthly = useMemo(() => (detail?.monthly || []).map((row) => ({
    ...row,
    name: new Date(`${row.month}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }),
    label: new Date(`${row.month}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })
  })), [detail]);

  const shown = detail && detail.item.itemId === selectedItemId ? detail : null;
  const unit = shown?.item.unit || '';

  return (
    <div className="space-y-5">
      <section className={cardClass}>
        <label htmlFor="item-usage-search" className="text-sm font-medium">เลือกน้ำยาที่ต้องการวิเคราะห์</label>
        <div className="relative mt-2">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input
            id="item-usage-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="พิมพ์ชื่อหรือรหัสน้ำยา"
            className="w-full rounded-[10px] border border-line bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-ink"
          />
        </div>
        {matches.length > 0 && (
          <ul className="mt-2 max-h-64 overflow-y-auto rounded-[10px] border border-line">
            {matches.map((item) => (
              <li key={item.itemId}>
                <button
                  type="button"
                  onClick={() => { onSelectItem(item.itemId); setSearch(''); }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50"
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="text-xs text-gray-600">{item.itemId}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {search.trim() && matches.length === 0 && <p className="mt-2 text-sm text-gray-600">ไม่พบน้ำยาที่ตรงกับคำค้น</p>}
      </section>

      {!selectedItemId && <p className="py-10 text-center text-sm text-gray-600">ค้นหาแล้วเลือกน้ำยา 1 รายการ หรือกดรายการจากแท็บภาพรวม</p>}
      {error && <div role="alert" className="flex items-center gap-3 rounded-xl bg-crit-bg px-4 py-3 text-sm font-medium text-crit"><AlertTriangle size={20} />{error}</div>}
      {shown?.refillUnavailable && <RefillUnavailableNotice />}
      {loading && !shown && (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-gray-600"><Loader2 className="animate-spin" size={24} />กำลังโหลด...</div>
      )}

      {shown && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-2xl font-medium">{shown.item.name} <span className="text-sm font-normal text-gray-600">{shown.item.itemId}</span></h2>
            {!shown.item.isActive && <span className="rounded-full bg-gray-100 px-2.5 py-[3px] text-xs font-medium text-gray-700">ปิดใช้งาน</span>}
            <span className={`rounded-full px-2.5 py-[3px] text-xs font-medium ${statusMeta[shown.reorder.status].badge}`}>{statusMeta[shown.reorder.status].label}</span>
            {loading && <Loader2 className="animate-spin text-gray-500" size={18} aria-label="กำลังโหลด" />}
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
            {[
              {
                label: 'ยอดใช้จริงช่วงนี้',
                value: formatNumber(shown.totals.usage, 2),
                sub: `เบิกไปหน้างาน ${formatNumber(shown.totals.dispensed, 2)} + เบิกเติม ${formatNumber(shown.totals.refill, 2)} · ${shown.range.days} วัน`
              },
              {
                label: 'เฉลี่ยต่อวัน',
                value: shown.totals.averageDailyTotal === null ? '-' : formatNumber(shown.totals.averageDailyTotal, 2),
                sub: shown.totals.averageDailyTotal === null
                  ? 'ยังไม่มีวันที่รู้ยอดครบในช่วงนี้ (นับล่าสุดตรงวันแรกของช่วง)'
                  : `≈ ${formatNumber(shown.totals.averageWeeklyTotal ?? 0)} ${unit}/สัปดาห์${shown.totals.averageDays !== null && shown.totals.averageDays < shown.range.days ? ` · คิด ${shown.totals.averageDays} วัน ถึงวันก่อนนับล่าสุด` : ''}`
              },
              { label: 'รับเข้าช่วงนี้', value: formatNumber(shown.totals.received), sub: shown.totals.adjusted ? `ปรับยอด ${formatNumber(shown.totals.adjusted)}` : unit },
              { label: 'คงเหลือตอนนี้', value: formatNumber(shown.item.quantity), sub: `Min ${formatNumber(shown.item.minThreshold)} ${unit}` },
              {
                label: 'ใช้ได้อีกก่อนถึง Min',
                value: shown.reorder.daysUntilMin === null ? '-' : `${formatNumber(shown.reorder.daysUntilMin)} วัน`,
                sub: `ตามเกณฑ์จัดซื้อ: เบิกไปหน้างาน 90 วันล่าสุด${shown.reorder.recommendedOrderQty ? ` · แนะนำสั่ง ${formatNumber(shown.reorder.recommendedOrderQty, 0)} ${unit}` : ''}`
              },
              {
                label: 'เบิกไปหน้างานล่าสุด',
                value: shown.totals.lastDispensedAt
                  ? new Date(shown.totals.lastDispensedAt).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
                  : '-',
                sub: `เบิกไปหน้างาน ${shown.totals.dispenseCount} ครั้งในช่วงที่เลือก`
              }
            ].map(({ label, value, sub }) => (
              <div key={label} className={cardClass}>
                <p className="text-[13px] text-gray-600">{label}</p>
                <p className="mt-1 text-[28px] font-medium leading-tight">{value}</p>
                <p className="mt-1 text-xs text-gray-600">{sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <section className={cardClass} aria-labelledby="item-daily-heading">
              <h3 id="item-daily-heading" className="text-lg font-medium">ยอดใช้จริงรายวัน</h3>
              <p className="mb-3 mt-0.5 text-[13px] text-gray-600">เบิกไปหน้างาน + เบิกเติม (กระจายตามช่วงที่ใช้) · เอาเมาส์ชี้ดูยอดรวม</p>
              <div className="h-64" role="img" aria-label="กราฟแท่งยอดใช้จริงรายวัน แยกเบิกไปหน้างานและเบิกเติม">
                <DailyUsageChart rows={dailyTrend} lastCountDate={shown.lastCountDate} />
              </div>
              <UsageLegend shaded={Boolean(shown.lastCountDate && shown.lastCountDate < shown.range.endDate)} />
            </section>

            <section className={cardClass} aria-labelledby="item-monthly-heading">
              <h3 id="item-monthly-heading" className="text-lg font-medium">ยอดใช้จริงรายเดือน</h3>
              <p className="mb-3 mt-0.5 text-[13px] text-gray-600">หน่วย: {unit}</p>
              <div className="h-64">
                {monthly.length === 0 ? <p className="py-20 text-center text-sm text-gray-600">ไม่มีการเบิกในช่วงนี้</p> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthly} margin={{ top: 20, left: 0, right: 8 }}>
                      <CartesianGrid stroke="#dcdcdf" vertical={false} />
                      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                      <YAxis hide />
                      <Tooltip content={<UsageTooltip />} />
                      <Bar dataKey="regular" name="เบิกไปหน้างาน" stackId="usage" fill={REGULAR_COLOR} maxBarSize={40} />
                      <Bar dataKey="refill" name="เบิกเติม" stackId="usage" fill={REFILL_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40}>
                        <LabelList dataKey="total" position="top" style={{ fontSize: 12, fontWeight: 600, fill: '#1d1f20' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <section className={`${cardClass} overflow-x-auto`} aria-labelledby="item-onhand-heading">
              <h3 id="item-onhand-heading" className="mb-3 text-lg font-medium">Lot คงเหลือ (FEFO)</h3>
              <table className="w-full border-separate border-spacing-0 text-left">
                <thead><tr><th className={`${thClass} rounded-l-[10px]`}>Lot</th><th className={thClass}>EXP</th><th className={`${thClass} rounded-r-[10px]`}>คงเหลือ</th></tr></thead>
                <tbody>
                  {shown.lotsOnHand.map((lot, index) => (
                    <tr key={`${lot.lotNo}-${lot.receivedOn}-${index}`}>
                      <td className={tdClass}>{lot.lotNo}</td>
                      <td className={`${tdClass} ${lot.daysUntilExpiry !== null && lot.daysUntilExpiry <= 30 ? 'font-medium text-crit' : ''}`}>
                        {thaiDate(lot.expDate)}
                        {lot.daysUntilExpiry !== null && <span className="block text-xs">{lot.daysUntilExpiry < 0 ? 'หมดอายุแล้ว' : `อีก ${lot.daysUntilExpiry} วัน`}</span>}
                      </td>
                      <td className={tdClass}>{formatNumber(lot.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.lotsOnHand.length === 0 && <p className="py-6 text-sm text-gray-600">ไม่มีของคงเหลือ</p>}
            </section>

            <section className={`${cardClass} overflow-x-auto`} aria-labelledby="item-bylot-heading">
              <h3 id="item-bylot-heading" className="mb-3 text-lg font-medium">ยอดเบิกแยกตาม Lot</h3>
              <table className="w-full border-separate border-spacing-0 text-left">
                <thead><tr><th className={`${thClass} rounded-l-[10px]`}>Lot</th><th className={`${thClass} rounded-r-[10px]`}>ยอดเบิก</th></tr></thead>
                <tbody>
                  {shown.byLot.map((lot) => (
                    <tr key={lot.lotNo}><td className={tdClass}>{lot.lotNo}</td><td className={tdClass}>{formatNumber(lot.qty)}</td></tr>
                  ))}
                </tbody>
              </table>
              {shown.byLot.length === 0 && <p className="py-6 text-sm text-gray-600">ไม่มีการเบิกในช่วงนี้</p>}
            </section>

            <section className={`${cardClass} overflow-x-auto`} aria-labelledby="item-byuser-heading">
              <h3 id="item-byuser-heading" className="mb-3 text-lg font-medium">ผู้เบิกสูงสุด 10 อันดับ</h3>
              <table className="w-full border-separate border-spacing-0 text-left">
                <thead><tr><th className={`${thClass} rounded-l-[10px]`}>ผู้ใช้</th><th className={thClass}>ครั้ง</th><th className={`${thClass} rounded-r-[10px]`}>ยอดเบิก</th></tr></thead>
                <tbody>
                  {shown.byUser.map((row) => (
                    <tr key={row.username}><td className={tdClass}>{row.username}</td><td className={tdClass}>{row.count}</td><td className={tdClass}>{formatNumber(row.qty)}</td></tr>
                  ))}
                </tbody>
              </table>
              {shown.byUser.length === 0 && <p className="py-6 text-sm text-gray-600">ไม่มีการเบิกในช่วงนี้</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
