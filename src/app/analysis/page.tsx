'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
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

type RiskFilter = 'all' | ReorderStatus;

const statusMeta: Record<ReorderStatus, { label: string; color: string; badge: string }> = {
  normal: { label: 'ปกติ', color: '#10b981', badge: 'bg-emerald-50 text-emerald-700' },
  reorder: { label: 'ควรสั่ง', color: '#f59e0b', badge: 'bg-amber-50 text-amber-700' },
  critical: { label: 'วิกฤต', color: '#ef4444', badge: 'bg-red-50 text-red-700' }
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

  const selectStatus = (entry: unknown) => {
    const status = (entry as { payload?: { status?: ReorderStatus }; status?: ReorderStatus })?.payload?.status
      || (entry as { status?: ReorderStatus })?.status;
    if (status) setRiskFilter(status);
  };

  if (loading && usage.length === 0 && insights.length === 0) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
        <p className="text-xs font-black text-gray-500">กำลังวิเคราะห์ข้อมูลการใช้น้ำยา...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-24">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Dashboard การใช้น้ำยา</h1>
          <p className="mt-1 text-sm font-bold text-gray-500">จัดลำดับน้ำยาที่ควรสั่งซื้อจากยอดเบิกย้อนหลัง 90 วัน</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 bg-white p-2 shadow-sm">
          <Calendar size={14} className="ml-2 text-gray-400" />
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-28 bg-transparent p-1 text-xs font-bold outline-none" />
          <span className="text-xs font-black text-gray-300">ถึง</span>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-28 bg-transparent p-1 text-xs font-bold outline-none" />
        </div>
      </div>

      {error && <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600"><AlertTriangle size={20} />{error}</div>}

      {!canPlanPurchases ? (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 p-6 text-sm font-bold text-amber-800">
          บัญชีนี้ดูยอดการใช้ได้ แต่ Dashboard วางแผนจัดซื้อสงวนสำหรับ Admin และ Manager
        </div>
      ) : <>
        <div className="flex gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
          {[
            { label: 'รายการวิกฤต', value: criticalCount, icon: CircleAlert, style: 'text-red-600 bg-red-50' },
            { label: 'รายการควรสั่ง', value: reorderCount, icon: ShoppingCart, style: 'text-amber-600 bg-amber-50' },
            { label: 'จำนวนแนะนำให้สั่ง', value: formatNumber(recommendedOrderTotal, 0), icon: PackageCheck, style: 'text-indigo-600 bg-indigo-50' },
            { label: 'ล็อตเสี่ยงใช้ไม่ทัน', value: expiryRisks.length, icon: Clock3, style: 'text-rose-600 bg-rose-50' }
          ].map(({ label, value, icon: Icon, style }) => (
            <div key={label} className="min-w-56 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm lg:min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
              <div className="mt-2 flex items-center justify-between"><p className="text-3xl font-black text-gray-900">{value}</p><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${style}`}><Icon size={20} /></div></div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
          <section className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm xl:col-span-2">
            <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 text-lg font-black text-gray-800"><ShoppingCart className="text-red-500" size={21} />วันคงเหลือเทียบเวลารอของ</h2><p className="mt-1 text-xs font-bold text-gray-400">เส้นแดง = 7 วัน กดแท่งเพื่อดูแนวโน้มรายน้ำยา</p></div></div>
            <div className="h-[22rem]"><ResponsiveContainer width="100%" height="100%"><BarChart data={riskItems.slice(0, 10)} layout="vertical" margin={{ left: 8, right: 28 }} onClick={selectChartItem}><CartesianGrid stroke="#f3f4f6" horizontal={false} /><XAxis type="number" tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 10, fontWeight: 700 }} /><Tooltip formatter={(value) => [`${formatNumber(Number(value) || 0)} วัน`, 'เหลือก่อนถึง Min']} /><ReferenceLine x={7} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '7 วัน', fill: '#ef4444', fontSize: 10 }} /><Bar dataKey={(item: ReagentUsageInsight) => item.daysUntilMin ?? 0} name="วันคงเหลือ" radius={[0, 8, 8, 0]}>{riskItems.slice(0, 10).map((item) => <Cell key={item.itemId} fill={statusMeta[item.status].color} cursor="pointer" />)}</Bar></BarChart></ResponsiveContainer></div>
          </section>

          <section className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm"><h2 className="text-lg font-black text-gray-800">สถานะน้ำยา</h2><p className="mt-1 text-xs font-bold text-gray-400">กดสีเพื่อกรองรายการด้านล่าง</p><div className="relative h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={4} onClick={selectStatus}>{statusPie.map((entry) => <Cell key={entry.status} fill={entry.color} cursor="pointer" />)}</Pie><Tooltip /><Legend verticalAlign="bottom" height={28} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-[10px] font-black uppercase text-gray-400">ทั้งหมด</span><span className="text-2xl font-black text-gray-900">{insights.length}</span></div></div></section>
        </div>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-black text-gray-800"><TrendingUp className="text-indigo-600" size={21} />แนวโน้มการใช้รายวัน</h2><p className="mt-1 text-xs font-bold text-gray-400">{selectedItem ? selectedItem.name : 'ภาพรวมทุกน้ำยา'} พร้อมค่าเฉลี่ยเคลื่อนที่ 7 วัน</p></div>{selectedItemId !== 'TOTAL' && <button onClick={() => setSelectedItemId('TOTAL')} className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-600">ดูภาพรวม</button>}</div><div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={dailyTrend}><CartesianGrid stroke="#f3f4f6" vertical={false} /><XAxis dataKey="displayDate" minTickGap={28} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Legend /><Line type="monotone" dataKey="used" name="ยอดเบิก" stroke="#4f46e5" strokeWidth={3} dot={false} /><Line type="monotone" dataKey="average7Days" name="เฉลี่ย 7 วัน" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} /></LineChart></ResponsiveContainer></div></section>

          <section className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm"><h2 className="mb-1 text-lg font-black text-gray-800">Top 10 น้ำยาที่ใช้มากสุด</h2><p className="mb-5 text-xs font-bold text-gray-400">ตามช่วงวันที่เลือก กดแท่งเพื่อดูแนวโน้ม</p><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={topUsage} layout="vertical" margin={{ left: 8, right: 20 }} onClick={selectChartItem}><CartesianGrid stroke="#f3f4f6" horizontal={false} /><XAxis type="number" tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 10, fontWeight: 700 }} /><Tooltip /><Bar dataKey="dispensed" name="ยอดเบิก" fill="#2563eb" radius={[0, 8, 8, 0]} cursor="pointer" /></BarChart></ResponsiveContainer></div></section>
        </div>

        <section className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-black text-gray-800"><AlertTriangle className="text-rose-500" size={21} />ลดของเสีย: ล็อตเสี่ยงใช้ไม่ทัน</h2><p className="mt-1 text-xs font-bold text-gray-400">เรียงตาม FEFO และใช้ค่าเฉลี่ยการเบิก 90 วัน</p></div><span className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">{expiryRisks.length} ล็อต</span></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{expiryRisks.slice(0, 9).map((lot) => <div key={`${lot.itemId}-${lot.lotNo}`} className="rounded-2xl border border-rose-100 bg-rose-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-gray-900">{lot.name}</p><p className="mt-1 text-xs font-bold text-rose-600">Lot {lot.lotNo} · EXP {lot.expDate}</p></div><span className="whitespace-nowrap text-xs font-black text-rose-700">{lot.daysUntilExpiry} วัน</span></div><p className="mt-3 text-xs font-bold text-gray-600">คงเหลือ {formatNumber(lot.quantity)} {lot.unit}{lot.expectedDaysToUse !== null && ` · คาดใช้หมด ${formatNumber(lot.expectedDaysToUse)} วัน`}</p></div>)}{expiryRisks.length === 0 && <p className="col-span-full py-8 text-center text-sm font-bold text-gray-400">ไม่พบล็อตที่คาดว่าจะใช้ไม่ทันก่อนหมดอายุ</p>}</div></section>

        <section className="overflow-hidden rounded-[2rem] border border-gray-100 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 p-6"><div><h2 className="text-lg font-black text-gray-800">แผนจัดซื้อรายน้ำยา</h2><p className="mt-1 text-xs font-bold text-gray-400">ค่าเฉลี่ยการใช้และคำแนะนำคำนวณจาก 90 วันล่าสุด</p></div><div className="flex gap-2">{(['all', 'critical', 'reorder', 'normal'] as RiskFilter[]).map((status) => <button key={status} onClick={() => setRiskFilter(status)} className={`rounded-xl px-3 py-2 text-xs font-black ${riskFilter === status ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>{status === 'all' ? 'ทั้งหมด' : statusMeta[status].label}</button>)}</div></div><div className="hidden overflow-x-auto md:block"><table className="w-full text-left"><thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400"><tr><th className="px-6 py-4">น้ำยา</th><th className="px-4 py-4 text-right">คงเหลือ</th><th className="px-4 py-4 text-right">เฉลี่ย/วัน</th><th className="px-4 py-4 text-right">เหลือก่อน Min</th><th className="px-4 py-4 text-right">แนะนำสั่ง</th><th className="px-6 py-4 text-right">สถานะ</th></tr></thead><tbody className="divide-y divide-gray-100">{filteredInsights.map((item) => <tr key={item.itemId} onClick={() => setSelectedItemId(item.itemId)} className="cursor-pointer hover:bg-indigo-50/50"><td className="px-6 py-4"><p className="font-bold text-gray-900">{item.name}</p><p className="text-xs font-bold text-gray-400">{item.itemId}</p></td><td className="px-4 py-4 text-right font-bold">{formatNumber(item.quantity)} {item.unit}</td><td className="px-4 py-4 text-right font-bold">{formatNumber(item.averageDailyUsage)}</td><td className="px-4 py-4 text-right font-bold">{item.daysUntilMin === null ? 'ข้อมูลไม่พอ' : `${formatNumber(item.daysUntilMin)} วัน`}</td><td className="px-4 py-4 text-right font-black text-indigo-600">{item.recommendedOrderQty ? `${formatNumber(item.recommendedOrderQty, 0)} ${item.unit}` : '-'}</td><td className="px-6 py-4 text-right"><span className={`rounded-full px-3 py-1.5 text-xs font-black ${statusMeta[item.status].badge}`}>{statusMeta[item.status].label}</span></td></tr>)}</tbody></table></div><div className="space-y-3 p-4 md:hidden">{filteredInsights.map((item) => <button key={item.itemId} onClick={() => setSelectedItemId(item.itemId)} className="w-full rounded-2xl border border-gray-100 p-4 text-left"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-gray-900">{item.name}</p><p className="mt-1 text-xs font-bold text-gray-400">เหลือ {formatNumber(item.quantity)} {item.unit} · เฉลี่ย {formatNumber(item.averageDailyUsage)}/วัน</p></div><ChevronRight className="text-gray-400" size={18} /></div><div className="mt-3 flex items-center justify-between"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusMeta[item.status].badge}`}>{statusMeta[item.status].label}</span><span className="text-xs font-black text-indigo-600">แนะนำสั่ง {formatNumber(item.recommendedOrderQty, 0)} {item.unit}</span></div></button>)}</div>{filteredInsights.length === 0 && <p className="p-10 text-center text-sm font-bold text-gray-400">ไม่พบรายการในสถานะที่เลือก</p>}</section>
      </>}
    </div>
  );
}
