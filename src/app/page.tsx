'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  AlertTriangle, 
  Package, 
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ClipboardList,
  Database,
  ArrowRightLeft,
  Clock,
  XCircle,
  Boxes,
  Activity
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { apiClient, Reagent, UsageResponse } from '@/lib/api-client';
import ReportModal from '@/components/report-modal';
import { useAuth } from '@/components/auth-provider';
import Link from 'next/link';

export default function Dashboard() {
  const { user } = useAuth();
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [usageData, setUsageData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const startDate = weekAgo.toISOString().split('T')[0];

      // Fetch separately to be more robust
      try {
        const dashData = await apiClient.getDashboard();
        setReagents(dashData);
      } catch (err) {
        console.error('Dashboard Fetch Error:', err);
        setError(prev => (prev ? prev + ' | ' : '') + 'ไม่สามารถดึงข้อมูลคลังสินค้าได้');
      }

      try {
        const usage = await apiClient.getUsage(startDate, today);
        setUsageData(usage);
      } catch (err) {
        console.error('Usage Fetch Error:', err);
        setError(prev => (prev ? prev + ' | ' : '') + 'ไม่สามารถดึงข้อมูลสรุปการใช้งานได้');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (isMounted) {
        await fetchData();
      }
    };
    load();
    return () => { isMounted = false; };
  }, [fetchData]);

  const stats = useMemo(() => {
    const total = reagents.length;
    const low = reagents.filter(r => r.quantity <= r.minThreshold).length;
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);

    let expired = 0;
    let nearExpiry = 0;
    
    reagents.forEach(r => {
      r.lots.forEach(l => {
        const exp = new Date(l.expDate);
        if (exp < now) expired++;
        else if (exp < thirtyDays) nearExpiry++;
      });
    });

    return [
      { name: 'Total Items', value: total, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
      { name: 'Low Stock', value: low, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
      { name: 'Near Expiry', value: nearExpiry, icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50' },
      { name: 'Expired', value: expired, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
    ];
  }, [reagents]);

  const jobTypes = useMemo(() => {
    return Array.from(new Set(reagents.map(r => r.jobType)));
  }, [reagents]);

  const filteredItems = useMemo(() => {
    return reagents.filter(item => {
      const terms = searchTerm.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const text = `${item.itemId} ${item.name}`.toLowerCase();
      return terms.length === 0 || terms.every(t => text.includes(t));
    });
  }, [reagents, searchTerm]);

  const totalUsedThisWeek = useMemo(() => {
    if (!usageData?.summary) return 0;
    return usageData.summary.reduce((sum, item) => sum + item.dispensed, 0);
  }, [usageData]);

  if (loading && reagents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-blue-600" size={48} />
        <p className="text-gray-500 animate-pulse font-black text-xs uppercase tracking-widest">กำลังดึงข้อมูลคลังล่าสุด...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-500 pb-20">
      {/* Airtable Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-3">
            LabStock <span className="text-gray-400 font-normal">/</span> <span className="bg-[#e7f0ff] text-[#166ee1] px-3 py-1 rounded-lg text-xl">Overview</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1 font-medium">Manage your reagent inventory in a structured workspace.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Sync Workspace
          </button>
          <button 
            onClick={() => setReportModalOpen(true)}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#166ee1] text-white hover:bg-[#1259b3] transition-all font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-blue-100"
          >
            <FileText size={16} />
            Generate Daily Report
          </button>
          </div>
          </div>

          {error && (
          <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in duration-300">
          <AlertTriangle size={20} />
          <p className="text-xs font-bold">{error}</p>
          </div>
          )}


      {/* Visual Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 ${stat.bg} ${stat.color} rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <stat.icon size={24} />
              </div>
              <div>
                <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest">{stat.name}</p>
                <p className="text-2xl font-black text-gray-900">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Quick Tools Column */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white border border-gray-100 rounded-[2rem] p-8 shadow-sm">
            <h2 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-6 flex items-center gap-2">
              <Activity size={18} className="text-[#166ee1]" />
              Workspace Tools
            </h2>
            <div className="grid grid-cols-1 gap-3">
              {[
                { name: 'Dispense Reagents', href: '/dispense', icon: ArrowRightLeft, bg: 'bg-blue-50', text: 'text-blue-600' },
                { name: 'Receive Stock', href: '/receive', icon: Boxes, bg: 'bg-green-50', text: 'text-green-600' },
                { name: 'Count Physical', href: '/count', icon: ClipboardList, bg: 'bg-purple-50', text: 'text-purple-600' },
                { name: 'Base Dictionary', href: '/master', icon: Database, bg: 'bg-amber-50', text: 'text-amber-600' },
              ].map((act) => (
                <Link key={act.name} href={act.href} className="flex items-center gap-4 p-4 rounded-2xl border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-all group">
                  <div className={`w-10 h-10 ${act.bg} ${act.text} rounded-xl flex items-center justify-center group-hover:rotate-6 transition-transform`}>
                    <act.icon size={20} />
                  </div>
                  <span className="text-sm font-bold text-gray-700">{act.name}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="bg-[#111827] p-8 rounded-[2rem] text-white relative overflow-hidden shadow-xl min-h-[300px] flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 -mr-8 -mt-8 rounded-full blur-3xl"></div>
            <div className="relative z-10">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Weekly Pulse</p>
                <div className="flex items-baseline gap-2 mt-2">
                    <p className="text-4xl font-black">{totalUsedThisWeek.toLocaleString()}</p>
                    <p className="text-xs font-bold text-gray-400 uppercase">Units</p>
                </div>
                
                {/* Micro Chart */}
                {(user?.role === 'Admin' || user?.role === 'Manager') && usageData?.weeklyStats && usageData.weeklyStats.length > 0 && (
                  <div className="h-24 w-full mt-4 -ml-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={usageData.weeklyStats}>
                        <defs>
                          <linearGradient id="colorPulse" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', fontSize: '10px' }}
                          itemStyle={{ color: '#fff' }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="totalDispensed" 
                          stroke="#6366f1" 
                          fillOpacity={1} 
                          fill="url(#colorPulse)" 
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <p className="text-xs text-gray-400 mt-4 font-medium">Activity is <span className="text-green-400 font-bold">Stable</span> matching current inventory flow.</p>
                <Link href="/analysis" className="mt-6 flex items-center justify-center w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl py-3 text-xs font-black uppercase tracking-widest transition-all">
                    Full Insights
                </Link>
            </div>
          </div>
        </div>

        {/* Data Grid View */}
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-[2rem] flex flex-col overflow-hidden shadow-sm">
          <div className="p-6 border-b border-gray-50 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="w-2 h-6 bg-[#166ee1] rounded-full"></div>
                <h2 className="text-lg font-black text-gray-800 uppercase tracking-tight">Inventory Base</h2>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input 
                type="text" 
                placeholder="Search reagents or IDs..."
                className="w-full pl-11 pr-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:bg-white border-transparent focus:border-blue-100 outline-none transition-all shadow-inner"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto max-h-[600px] no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-gray-50/50 sticky top-0 z-10 border-b border-gray-100">
                  <th className="px-6 md:px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.1em]">Name & ID</th>
                  <th className="px-6 md:px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.1em]">Lot Health</th>
                  <th className="px-6 md:px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.1em] text-center">In Stock</th>
                  <th className="px-6 md:px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.1em] text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredItems.map((item) => {
                  const isLow = item.quantity <= item.minThreshold;
                  return (
                    <tr key={item.itemId} className="hover:bg-blue-50/20 transition-colors group cursor-pointer">
                      <td className="px-6 md:px-8 py-5">
                        <p className="text-sm font-black text-gray-900 group-hover:text-[#166ee1] transition-colors line-clamp-1">{item.name}</p>
                        <p className="text-[10px] text-gray-400 font-bold mt-0.5 uppercase tracking-tighter">Record ID: {item.itemId}</p>
                      </td>
                      <td className="px-6 md:px-8 py-5">
                        <div className="flex gap-1.5">
                            {item.lots?.slice(0, 4).map((lot, i) => {
                                const isExp = new Date(lot.expDate) < new Date();
                                return (
                                    <div key={i} title={`EXP: ${lot.expDate}`} className={`w-3 h-3 rounded-full ${isExp ? 'bg-red-400' : 'bg-green-400'} border-2 border-white ring-1 ring-gray-100`} />
                                )
                            })}
                        </div>
                      </td>
                      <td className="px-8 py-5 text-center">
                        <p className="text-lg font-black text-gray-900">{item.quantity} <span className="text-[10px] font-bold text-gray-400 uppercase">{item.unit}</span></p>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tight ${isLow ? 'bg-red-50 text-red-600 border border-red-100 animate-pulse' : 'bg-green-50 text-green-600 border border-green-100'}`}>
                          {isLow ? 'Critical' : 'Operational'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ReportModal 
        isOpen={reportModalOpen} 
        onClose={() => setReportModalOpen(false)}
        data={reagents}
        jobTypes={jobTypes}
      />
    </div>
  );
}
