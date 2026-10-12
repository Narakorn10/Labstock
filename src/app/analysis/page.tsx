'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  CircleAlert,
  Clock3,
  Loader2,
  Lock,
  PackageCheck,
  ShoppingCart,
  TrendingUp
} from 'lucide-react';
import {
  apiClient,
  DailyStat,
  ExpiryRiskInsight,
  ReagentUsageInsight,
  ReorderStatus,
  UsageData
} from '@/lib/api-client';
import { useAuth } from '@/components/auth-provider';
import { ItemUsagePanel } from '@/components/analysis/item-usage-panel';

type RiskFilter = 'all' | ReorderStatus;
type AnalysisTab = 'overview' | 'item';

const statusMeta: Record<ReorderStatus, { label: string; color: string; badge: string }> = {
  normal: { label: 'ปกติ', color: '#237a3f', badge: 'bg-ok-bg text-ok' },
  reorder: { label: 'ควรสั่ง', color: '#a5670f', badge: 'bg-warn-bg text-warn' },
  critical: { label: 'วิกฤต', color: '#c9302c', badge: 'bg-crit-bg text-crit' }
};

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits }).format(value);
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function AnalysisPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageData[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [insights, setInsights] = useState<ReagentUsageInsight[]>([]);
  const [expiryRisks, setExpiryRisks] = useState<ExpiryRiskInsight[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('TOTAL');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [tab, setTab] = useState<AnalysisTab>('overview');
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 89);
    return toIsoDate(date);
  });
  const [endDate, setEndDate] = useState(() => toIsoDate(new Date()));

  const canPlanPurchases = user?.role === 'Admin' || user?.role === 'Manager';

  useEffect(() => {
    let cancelled = false;
    const fetchUsage = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.getUsage(startDate, endDate);
        if (cancelled) return;
        setUsage(response.summary || []);
        setDailyStats(response.dailyStats || []);
        setInsights(response.insights || []);
        setExpiryRisks(response.expiryRisks || []);
      } catch (fetchError) {
        console.error('Usage Fetch Error:', fetchError);
        if (!cancelled) setError('ไม่สามารถดึงข้อมูลวิเคราะห์การใช้น้ำยาได้');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchUsage();
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const selectedItem = useMemo(
    () => insights.find((item) => item.itemId === selectedItemId),
    [insights, selectedItemId]
  );

  const dailyTrend = useMemo(() => {
    const totals = new Map(dailyStats.map((stat) => [stat.date, stat]));
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    const rows: Array<{ date: string; displayDate: string; used: number; average7Days: number }> = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      const date = toIsoDate(cursor);
      const stat = totals.get(date);
      const used = selectedItemId === 'TOTAL'
        ? stat?.totalDispensed || 0
        : stat?.items[selectedItemId] || 0;
      const recentValues = [...rows.slice(-6).map((row) => row.used), used];
      rows.push({
        date,
        displayDate: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(cursor),
        used,
        average7Days: recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return rows;
  }, [dailyStats, endDate, selectedItemId, startDate]);

  const topUsage = useMemo(() => [...usage]
    .sort((left, right) => right.dispensed - left.dispensed)
    .slice(0, 10), [usage]);

  const riskItems = useMemo(() => insights
    .filter((item) => item.status !== 'normal')
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'critical' ? -1 : 1;
      return (left.daysUntilMin ?? Number.POSITIVE_INFINITY) - (right.daysUntilMin ?? Number.POSITIVE_INFINITY);
    }), [insights]);

  const filteredInsights = useMemo(() => insights.filter((item) => (
    riskFilter === 'all' || item.status === riskFilter
  )), [insights, riskFilter]);

  const statusPie = useMemo(() => (['normal', 'reorder', 'critical'] as ReorderStatus[]).map((status) => ({
    name: statusMeta[status].label,
    status,
    value: insights.filter((item) => item.status === status).length,
    color: statusMeta[status].color
  })), [insights]);

  const criticalCount = insights.filter((item) => item.status === 'critical').length;
  const reorderCount = insights.filter((item) => item.status === 'reorder').length;
  const recommendedOrderTotal = riskItems.reduce((sum, item) => sum + item.recommendedOrderQty, 0);

  const selectChartItem = (state: unknown) => {
    const item = (state as { activePayload?: Array<{ payload?: { itemId?: string } }> })?.activePayload?.[0]?.payload;
    if (item?.itemId) {
      setSelectedItemId(item.itemId);
      setRiskFilter('all');
    }
  };

  const openItemDetail = (itemId: string) => {
    setDetailItemId(itemId);
    setTab('item');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectStatus = (entry: unknown) => {
    const status = (entry as { payload?: { status?: ReorderStatus }; status?: ReorderStatus })?.payload?.status
      || (entry as { status?: ReorderStatus })?.status;
    if (status) setRiskFilter(status);
  };

  if (loading && usage.length === 0 && insights.length === 0) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-gray-600" size={44} />
        <p className="text-sm text-gray-600">กำลังวิเคราะห์ข้อมูลการใช้น้ำยา...</p>
      </div>
    );
  }

  const peakUsage = dailyTrend.reduce((max, row) => Math.max(max, row.used), 0);
  const cardClass = 'rounded-2xl border border-line bg-white p-5';
  const axisTick = { fontSize: 12, fill: '#6b6e72' };
  const nameTick = { fontSize: 12, fill: '#1d1f20' };
  const shortDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="mr-auto">
          <h1 className="text-[32px] leading-tight font-medium text-ink">Dashboard การใช้น้ำยา</h1>
          <p className="mt-1.5 text-[15px] text-gray-600">จัดลำดับน้ำยาที่ควรสั่งซื้อจากยอดเบิกย้อนหลัง 90 วัน</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-white px-3 py-1.5 text-sm">
          <Calendar size={16} className="text-gray-600" aria-hidden="true" />
          <input type="date" aria-label="วันที่เริ่มต้น" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="bg-transparent p-1 text-sm outline-none" />
          <span className="text-gray-600">ถึง</span>
          <input type="date" aria-label="วันที่สิ้นสุด" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="bg-transparent p-1 text-sm outline-none" />
        </div>
      </div>

      {error && <div role="alert" className="flex items-center gap-3 rounded-xl bg-crit-bg px-4 py-3 text-sm font-medium text-crit"><AlertTriangle size={20} />{error}</div>}

      {!canPlanPurchases ? (
        <div className="flex items-center gap-3 rounded-2xl bg-warn-bg px-6 py-5 text-[15px] font-medium text-warn">
          <Lock size={18} aria-hidden="true" />
          บัญชีนี้ดูยอดการใช้ได้ แต่ Dashboard วางแผนจัดซื้อสงวนสำหรับ Admin และ Manager
        </div>
      ) : <>
        <div className="flex gap-2" role="tablist" aria-label="มุมมองการวิเคราะห์">
          {([['overview', 'ภาพรวม'], ['item', 'รายน้ำยา']] as Array<[AnalysisTab, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${tab === value ? 'border-ink bg-ink text-white' : 'border-line bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'item' ? (
          <ItemUsagePanel
            items={insights}
            selectedItemId={detailItemId}
            onSelectItem={setDetailItemId}
            startDate={startDate}
            endDate={endDate}
          />
        ) : <>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
          {[
            { label: 'รายการวิกฤต', value: criticalCount, unit: 'รายการ', icon: CircleAlert, style: 'text-crit bg-crit-bg' },
            { label: 'รายการควรสั่ง', value: reorderCount, unit: 'รายการ', icon: ShoppingCart, style: 'text-warn bg-warn-bg' },
            { label: 'จำนวนแนะนำให้สั่ง', value: formatNumber(recommendedOrderTotal, 0), unit: 'หน่วย', icon: PackageCheck, style: 'bg-blue-100 text-blue-800' },
            { label: 'ล็อตเสี่ยงใช้ไม่ทัน', value: expiryRisks.length, unit: 'lot', icon: Clock3, style: 'text-crit bg-crit-bg' }
          ].map(({ label, value, unit, icon: Icon, style }) => (
            <div key={label} className={`${cardClass} flex items-center justify-between gap-3`}>
              <div>
                <p className="text-[15px] text-gray-600">{label}</p>
                <p className="mt-1.5 text-[40px] font-medium leading-[1.1] tracking-[-0.02em]">{value} <span className="text-sm font-normal text-gray-600">{unit}</span></p>
              </div>
              <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${style}`} aria-hidden="true"><Icon size={20} strokeWidth={1.5} /></span>
            </div>
          ))}
        </div>

        <section aria-labelledby="status-heading" className={cardClass}>
          <h2 id="status-heading" className="text-xl font-medium">สถานะน้ำยา</h2>
          <p className="mt-0.5 text-[13px] text-gray-600">กดสีเพื่อกรองรายการด้านล่าง</p>
          <div className="md:grid md:grid-cols-[280px_minmax(0,1fr)] md:items-center md:gap-8">
            <div className="relative mt-3 h-[210px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={66} outerRadius={96} paddingAngle={0} startAngle={90} endAngle={-270} stroke="none" onClick={selectStatus}>
                    {statusPie.map((entry) => <Cell key={entry.status} fill={entry.color} cursor="pointer" />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs text-gray-600">ทั้งหมด</span>
                <span className="text-[32px] font-medium leading-none">{insights.length}</span>
              </div>
            </div>
            <div className="mt-4 md:mt-0">
              {statusPie.map((entry) => (
                <button
                  key={entry.status}
                  type="button"
                  onClick={() => setRiskFilter(riskFilter === entry.status ? 'all' : entry.status)}
                  aria-pressed={riskFilter === entry.status}
                  className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-3 text-left text-sm transition-colors hover:bg-[#fafafa] ${riskFilter === entry.status ? 'bg-gray-100' : ''}`}
                >
                  <span className="size-2.5 rounded-full" style={{ background: entry.color }} aria-hidden="true" />
                  <span className="flex-1">{entry.name}</span>
                  <span className="font-semibold">{entry.value}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <section aria-labelledby="trend-heading" className={cardClass}>
            <div className="mb-3 flex flex-wrap items-start gap-2.5">
              <TrendingUp className="mt-0.5 text-blue-800" size={20} strokeWidth={1.5} aria-hidden="true" />
              <div className="mr-auto">
                <h2 id="trend-heading" className="text-xl font-medium">แนวโน้มการใช้รายวัน</h2>
                <p className="mt-0.5 text-[13px] text-gray-600">{selectedItem ? selectedItem.name : 'ภาพรวมทุกน้ำยา'} พร้อมค่าเฉลี่ยเคลื่อนที่ 7 วัน</p>
              </div>
              {selectedItemId !== 'TOTAL' && (
                <button type="button" onClick={() => setSelectedItemId('TOTAL')} className="rounded-[10px] border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-gray-50">ดูภาพรวม</button>
              )}
            </div>
            <div className="mb-2 flex items-center gap-4 text-[13px] text-gray-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3.5 bg-[#3f5f80]" aria-hidden="true" />ยอดเบิก</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3.5 border-t-2 border-dashed border-[#a5670f]" aria-hidden="true" />เฉลี่ย 7 วัน</span>
              <span className="ml-auto">สูงสุด {formatNumber(peakUsage, 0)} / วัน</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyTrend} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid stroke="#dcdcdf" strokeDasharray="0" vertical={false} />
                  <XAxis dataKey="displayDate" minTickGap={60} tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip />
                  <Line type="linear" dataKey="used" name="ยอดเบิก" stroke="#3f5f80" strokeWidth={1.5} dot={false} />
                  <Line type="linear" dataKey="average7Days" name="เฉลี่ย 7 วัน" stroke="#a5670f" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section aria-labelledby="top-heading" className={cardClass}>
            <h2 id="top-heading" className="text-xl font-medium">Top 10 น้ำยาที่ใช้มากสุด</h2>
            <p className="mb-3 mt-0.5 text-[13px] text-gray-600">ตามช่วงวันที่เลือก กดแท่งเพื่อดูแนวโน้ม</p>
            <div className="h-[22rem]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topUsage} layout="vertical" margin={{ left: 8, right: 28 }} onClick={selectChartItem}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={205} tick={nameTick} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="dispensed" name="ยอดเบิก" fill="#5980a6" barSize={16} radius={[0, 4, 4, 0]} cursor="pointer">
                    <LabelList dataKey="dispensed" position="right" style={{ fontSize: 12, fontWeight: 600, fill: '#1d1f20' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section aria-labelledby="expiry-heading" className={cardClass}>
          <div className="mb-3.5 flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 text-crit" size={20} strokeWidth={1.5} aria-hidden="true" />
            <div className="mr-auto">
              <h2 id="expiry-heading" className="text-xl font-medium">ลดของเสีย: ล็อตเสี่ยงใช้ไม่ทัน</h2>
              <p className="mt-0.5 text-[13px] text-gray-600">เรียงตาม FEFO และใช้ค่าเฉลี่ยการเบิก 90 วัน</p>
            </div>
            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-crit-bg px-2.5 py-[3px] text-xs font-medium text-crit">{expiryRisks.length} ล็อต</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {expiryRisks.slice(0, 9).map((lot) => (
              <div key={`${lot.itemId}-${lot.lotNo}`} className="rounded-xl bg-crit-bg p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{lot.name}</p>
                  <span className="whitespace-nowrap text-[13px] font-semibold text-crit">{lot.daysUntilExpiry < 0 ? 'หมดอายุแล้ว' : `${lot.daysUntilExpiry} วัน`}</span>
                </div>
                <p className="mt-1 text-xs text-crit">Lot {lot.lotNo} · EXP {shortDate(lot.expDate)}</p>
                <p className="mt-2.5 text-[13px] text-gray-700">คงเหลือ {formatNumber(lot.quantity)} {lot.unit}{lot.expectedDaysToUse !== null && ` · คาดใช้หมด ${formatNumber(lot.expectedDaysToUse)} วัน`}</p>
              </div>
            ))}
            {expiryRisks.length === 0 && <p className="col-span-full py-6 text-sm text-gray-600">ไม่พบล็อตที่คาดว่าจะใช้ไม่ทันก่อนหมดอายุ</p>}
          </div>
        </section>

        <section aria-labelledby="plan-heading" className={cardClass}>
          <div className="mb-3.5 flex flex-wrap items-center gap-4">
            <div className="mr-auto">
              <h2 id="plan-heading" className="text-xl font-medium">แผนจัดซื้อรายน้ำยา</h2>
              <p className="mt-0.5 text-[13px] text-gray-600">ค่าเฉลี่ยการใช้และคำแนะนำคำนวณจาก 90 วันล่าสุด · กดรายการเพื่อดูรายละเอียด</p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="กรองตามสถานะ">
              {(['all', 'critical', 'reorder', 'normal'] as RiskFilter[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setRiskFilter(status)}
                  aria-pressed={riskFilter === status}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${riskFilter === status ? 'border-ink bg-ink text-white' : 'border-line bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {status === 'all' ? 'ทั้งหมด' : statusMeta[status].label}
                </button>
              ))}
            </div>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-separate border-spacing-0 text-left">
              <caption className="sr-only">แผนจัดซื้อรายน้ำยา</caption>
              <thead>
                <tr>
                  <th scope="col" className="rounded-l-[10px] bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">น้ำยา</th>
                  <th scope="col" className="bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">คงเหลือ</th>
                  <th scope="col" className="bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">เฉลี่ย/วัน</th>
                  <th scope="col" className="bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">เหลือก่อน Min</th>
                  <th scope="col" className="bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">แนะนำสั่ง</th>
                  <th scope="col" className="rounded-r-[10px] bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filteredInsights.map((item) => (
                  <tr key={item.itemId} onClick={() => openItemDetail(item.itemId)} className="cursor-pointer transition-colors hover:bg-[#fafafa]">
                    <td className="border-b border-line px-3.5 py-3 text-sm">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-gray-600">{item.itemId}</div>
                    </td>
                    <td className="border-b border-line px-3.5 py-3 text-sm">{formatNumber(item.quantity)} {item.unit}</td>
                    <td className="border-b border-line px-3.5 py-3 text-sm">{formatNumber(item.averageDailyUsage)}</td>
                    <td className="border-b border-line px-3.5 py-3 text-sm">{item.daysUntilMin === null ? 'ข้อมูลไม่พอ' : `${formatNumber(item.daysUntilMin)} วัน`}</td>
                    <td className="border-b border-line px-3.5 py-3 text-sm font-semibold">{item.recommendedOrderQty ? `${formatNumber(item.recommendedOrderQty, 0)} ${item.unit}` : '-'}</td>
                    <td className="border-b border-line px-3.5 py-3 text-sm">
                      <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-medium ${statusMeta[item.status].badge}`}>{statusMeta[item.status].label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {filteredInsights.map((item) => (
              <button key={item.itemId} type="button" onClick={() => openItemDetail(item.itemId)} className="w-full rounded-xl border border-line p-4 text-left">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="mt-1 text-xs text-gray-600">เหลือ {formatNumber(item.quantity)} {item.unit} · เฉลี่ย {formatNumber(item.averageDailyUsage)}/วัน</p>
                  </div>
                  <ChevronRight className="text-gray-400" size={18} />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className={`rounded-full px-2.5 py-[3px] text-xs font-medium ${statusMeta[item.status].badge}`}>{statusMeta[item.status].label}</span>
                  <span className="text-xs font-semibold">แนะนำสั่ง {formatNumber(item.recommendedOrderQty, 0)} {item.unit}</span>
                </div>
              </button>
            ))}
          </div>
          {filteredInsights.length === 0 && <p className="py-10 text-sm text-gray-600">ไม่พบรายการในสถานะที่เลือก</p>}
        </section>
        </>}
      </>}
    </div>
  );
}
