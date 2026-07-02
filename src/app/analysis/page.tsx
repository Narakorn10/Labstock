'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import { 
  BarChart3, 
  TrendingUp, 
  AlertTriangle, 
  Loader2,
  Calendar,
  Filter,
  ArrowDownToLine,
  ArrowUpFromLine,
  Activity
} from 'lucide-react';
import { apiClient, Reagent, UsageData, DailyStat, UsageResponse } from '@/lib/api-client';
import { useAuth } from '@/components/auth-provider';

export default function AnalysisPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [usage, setUsage] = useState<UsageData[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [expiringSoon, setExpiringSoon] = useState<NonNullable<UsageResponse['expiringSoon']>>([]);
  const [slowMoving, setSlowMoving] = useState<NonNullable<UsageResponse['slowMoving']>>([]);
  const [selectedItemId, setSelectedItemId] = useState<string>('TOTAL');

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch separately to be more robust
        try {
          const dashData = await apiClient.getDashboard();
          setReagents(dashData);
        } catch (err) {
          console.error('Dashboard Fetch Error:', err);
          setError(prev => (prev ? prev + ' | ' : '') + 'ไม่สามารถดึงข้อมูลคลังสินค้าได้');
        }

        try {
          const usageResponse = await apiClient.getUsage(startDate, endDate);
          setUsage(usageResponse.summary || []);
          setDailyStats(usageResponse.dailyStats || []);
          setExpiringSoon(usageResponse.expiringSoon || []);
          setSlowMoving(usageResponse.slowMoving || []);
        } catch (err) {
          console.error('Usage Fetch Error:', err);
          setError(prev => (prev ? prev + ' | ' : '') + 'ไม่สามารถดึงข้อมูลสถิติการใช้งานได้');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [startDate, endDate]);

  const stockStats = useMemo(() => {
    const total = reagents.length;
    const low = reagents.filter(r => r && r.quantity <= r.minThreshold).length;
    const healthy = total - low;
    
    return [
      { name: 'ปกติ', value: healthy, color: '#10b981' },
      { name: 'ใกล้หมด', value: low, color: '#ef4444' }
    ];
  }, [reagents]);

  const topUsage = useMemo(() => {
    return [...usage]
      .sort((a, b) => b.dispensed - a.dispensed)
      .slice(0, 10);
  }, [usage]);

  const weeklyTrend = useMemo(() => {
    if (!dailyStats.length) return [];

    // Helper to get week number
    const getWeek = (date: Date) => {
      const onejan = new Date(date.getFullYear(), 0, 1);
      return Math.ceil((((date.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
    };

    const weeks: Record<string, { weekLabel: string; value: number }> = {};

    dailyStats.forEach(stat => {
      const date = new Date(stat.date);
      const weekNum = getWeek(date);
      const year = date.getFullYear();
      const key = `${year}-W${weekNum}`;

      if (!weeks[key]) {
        weeks[key] = { weekLabel: `สัปดาห์ที่ ${weekNum}`, value: 0 };
      }

      if (selectedItemId === 'TOTAL') {
        weeks[key].value += stat.totalDispensed;
      } else {
        weeks[key].value += stat.items[selectedItemId] || 0;
      }
    });

    return Object.values(weeks);
  }, [dailyStats, selectedItemId]);

  const selectedItemName = useMemo(() => {
    if (selectedItemId === 'TOTAL') return 'ทั้งหมดในแล็บ';
    return reagents.find(r => r.itemId === selectedItemId)?.name || 'Unknown';
  }, [selectedItemId, reagents]);

  if (loading && reagents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-blue-600" size={48} />
        <p className="text-gray-500 animate-pulse font-black text-xs">กำลังประมวลผลข้อมูลสถิติ...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      {/* Header & Date Picker */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">การวิเคราะห์ (Analysis)</h1>
          <p className="text-gray-500 text-sm font-bold">สรุปสัดส่วนสต๊อกและการใช้งานน้ำยา</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-xl border border-gray-100">
            <Calendar size={14} className="text-gray-400" />
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent border-none text-[10px] font-black focus:ring-0 p-0 w-24"
            />
          </div>
          <span className="text-gray-300 text-[10px] font-black">TO</span>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-xl border border-gray-100">
            <Calendar size={14} className="text-gray-400" />
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent border-none text-[10px] font-black focus:ring-0 p-0 w-24"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in duration-300">
          <AlertTriangle size={20} />
          <p className="text-xs font-bold">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Items</p>
          <div className="flex items-center justify-between">
            <p className="text-3xl font-black text-gray-900">{reagents.length}</p>
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
              <BarChart3 size={20} />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">Low Stock</p>
          <div className="flex items-center justify-between">
            <p className="text-3xl font-black text-red-600">{stockStats.find(s => s.name === 'ใกล้หมด')?.value}</p>
            <div className="w-10 h-10 bg-red-50 text-red-600 rounded-xl flex items-center justify-center">
              <AlertTriangle size={20} />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Total Dispensed</p>
          <div className="flex items-center justify-between">
            <p className="text-3xl font-black text-indigo-600">
              {usage.reduce((sum, item) => sum + item.dispensed, 0).toLocaleString()}
            </p>
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
              <ArrowUpFromLine size={20} />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[10px] font-black text-green-400 uppercase tracking-widest mb-1">Total Received</p>
          <div className="flex items-center justify-between">
            <p className="text-3xl font-black text-green-600">
              {usage.reduce((sum, item) => sum + item.received, 0).toLocaleString()}
            </p>
            <div className="w-10 h-10 bg-green-50 text-green-600 rounded-xl flex items-center justify-center">
              <ArrowDownToLine size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* 📈 Weekly Trend Chart (Admin & Manager Only) */}
      {(user?.role === 'Admin' || user?.role === 'Manager') && dailyStats.length > 0 && (
        <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-black text-gray-800 flex items-center gap-2 text-xl">
                <TrendingUp size={24} className="text-indigo-600" />
                แนวโน้มการใช้น้ำยารายสัปดาห์
              </h2>
              <p className="text-gray-400 text-xs font-bold mt-1">
                กำลังแสดง: <span className="text-indigo-600 uppercase tracking-wider">{selectedItemName}</span>
              </p>
            </div>
            {selectedItemId !== 'TOTAL' && (
              <button 
                onClick={() => setSelectedItemId('TOTAL')}
                className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-100 transition-all border border-indigo-100"
              >
                ดูภาพรวมทั้งหมด
              </button>
            )}
          </div>
          
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis 
                  dataKey="weekLabel" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#9ca3af' }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#9ca3af' }}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ fontWeight: 900, marginBottom: '0.25rem' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  name="จำนวนที่ใช้" 
                  stroke="#4f46e5" 
                  strokeWidth={4} 
                  dot={{ r: 6, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 8, strokeWidth: 0 }}
                  animationDuration={1000}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 📊 Usage Chart */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-gray-800 flex items-center gap-2">
              <TrendingUp size={20} className="text-blue-600" />
              การใช้งาน 10 อันดับแรก
            </h2>
          </div>
          
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topUsage} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700 }}
                  width={100}
                />
                <Tooltip 
                  cursor={{ fill: '#f9fafb' }}
                  contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="dispensed" name="เบิกจ่าย" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 📊 Stock Pie Chart */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center">
          <h2 className="w-full text-left font-black text-gray-800 flex items-center gap-2 mb-8">
            <Filter size={20} className="text-green-600" />
            สัดส่วนสุขภาพสต๊อก
          </h2>
          
          <div className="h-64 w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stockStats}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={8}
                  dataKey="value"
                >
                  {stockStats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <p className="text-[10px] font-black text-gray-400 uppercase">Total</p>
              <p className="text-2xl font-black text-gray-900">{reagents.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Insights (Admin/Manager Only) */}
      {(user?.role === 'Admin' || user?.role === 'Manager') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ⏰ Expiring Soon */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
            <h2 className="font-black text-gray-800 flex items-center gap-2">
              <AlertTriangle size={20} className="text-red-600" />
              ใกล้หมดอายุ (Expiring Soon)
            </h2>
            <div className="space-y-4">
              {expiringSoon.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-red-50 rounded-2xl border border-red-100">
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{item.name}</p>
                    <p className="text-[10px] font-bold text-red-600 uppercase">EXP: {item.expDate} | Lot: {item.lotNo}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-gray-900">{item.quantity}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">ขวด/ชุด</p>
                  </div>
                </div>
              ))}
              {expiringSoon.length === 0 && (
                <p className="text-center py-8 text-gray-400 font-bold italic text-sm">ไม่มีรายการใกล้หมดอายุใน 90 วัน</p>
              )}
            </div>
          </div>

          {/* 🐢 Slow Moving Items */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
            <h2 className="font-black text-gray-800 flex items-center gap-2">
              <Activity size={20} className="text-amber-600" />
              ของค้างสต๊อก (Slow Moving)
            </h2>
            <div className="space-y-4">
              {slowMoving.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{item.name}</p>
                    <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">ไม่มีการเบิกใน 30 วันที่ผ่านมา</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-gray-900">{item.stock}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">คงเหลือ</p>
                  </div>
                </div>
              ))}
              {slowMoving.length === 0 && (
                <p className="text-center py-8 text-gray-400 font-bold italic text-sm">ไม่มีรายการค้างสต๊อก</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Usage Table */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-gray-50 flex justify-between items-center">
          <h2 className="font-black text-gray-800">รายละเอียดการใช้รายรายการ</h2>
          <button className="text-xs font-black text-blue-600 uppercase tracking-widest px-4 py-2 bg-blue-50 rounded-xl">Download CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Reagent Name</th>
                <th className="px-8 py-4 text-[10px] font-black text-blue-400 uppercase tracking-widest text-center">Received</th>
                <th className="px-8 py-4 text-[10px] font-black text-indigo-400 uppercase tracking-widest text-center">Dispensed</th>
                <th className="px-8 py-4 text-[10px] font-black text-amber-400 uppercase tracking-widest text-center">Adjusted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {usage.map((item) => (
                <tr 
                  key={item.itemId} 
                  className={`hover:bg-blue-50 transition-colors cursor-pointer ${selectedItemId === item.itemId ? 'bg-blue-50/50' : ''}`}
                  onClick={() => {
                    if (user?.role === 'Admin' || user?.role === 'Manager') {
                      setSelectedItemId(item.itemId);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                >
                  <td className="px-8 py-4">
                    <p className="font-bold text-gray-900 text-sm">{item.name}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">ID: {item.itemId}</p>
                  </td>
                  <td className="px-8 py-4 text-center font-black text-gray-700 text-sm">{item.received}</td>
                  <td className="px-8 py-4 text-center font-black text-blue-600 text-sm">{item.dispensed}</td>
                  <td className="px-8 py-4 text-center font-black text-amber-600 text-sm">{item.adjusted}</td>
                </tr>
              ))}
              {usage.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-8 py-12 text-center text-gray-400 font-bold text-sm italic">
                    ไม่พบข้อมูลการใช้งานในช่วงเวลาที่เลือก
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
