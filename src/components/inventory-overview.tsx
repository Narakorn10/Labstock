'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  Clock,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { apiClient, Reagent } from '@/lib/api-client';
import ReportModal from '@/components/report-modal';
import ReagentDetailModal from '@/components/reagent-detail-modal';
import { useAuth } from '@/components/auth-provider';

export default function InventoryOverview() {
  const { user, loading: authLoading } = useAuth();
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJobType, setSelectedJobType] = useState<string>('All');
  const [selectedReagentType, setSelectedReagentType] = useState<string>('All');
  const [selectedReagent, setSelectedReagent] = useState<Reagent | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const dashData = await apiClient.getDashboard();
      setReagents(dashData);
    } catch (err) {
      console.error('Inventory overview fetch error:', err);
      setError('Unable to load inventory overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || typeof window === "undefined") {
      return;
    }

    const token = window.localStorage.getItem("labstock_token");
    if (!token) {
      return;
    }

    let isMounted = true;

    const load = async () => {
      if (isMounted) {
        await fetchData();
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [authLoading, fetchData, user]);

  const stats = useMemo(() => {
    const total = reagents.length;
    const low = reagents.filter((r) => r.quantity <= r.minThreshold).length;
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);

    let expired = 0;
    let nearExpiry = 0;

    reagents.forEach((reagent) => {
      reagent.lots.forEach((lot) => {
        const exp = new Date(lot.expDate);
        if (exp < now) {
          expired += 1;
        } else if (exp < thirtyDays) {
          nearExpiry += 1;
        }
      });
    });

    return [
      { name: 'Total Items', value: total, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
      { name: 'Low Stock', value: low, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
      { name: 'Near Expiry', value: nearExpiry, icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50' },
      { name: 'Expired Lots', value: expired, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
    ];
  }, [reagents]);

  const jobTypes = useMemo(() => {
    const types = Array.from(new Set(reagents.map((r) => r.jobType).filter(Boolean)));
    return ['All', ...types];
  }, [reagents]);

  const reagentTypes = useMemo(() => {
    const types = Array.from(new Set(reagents.map((r) => r.reagentType).filter(Boolean)));
    return ['All', ...types];
  }, [reagents]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return reagents.filter((item) => {
      const matchSearch =
        normalizedSearch === '' ||
        `${item.itemId} ${item.name}`.toLowerCase().includes(normalizedSearch);
      const matchJob = selectedJobType === 'All' || item.jobType === selectedJobType;
      const matchType = selectedReagentType === 'All' || item.reagentType === selectedReagentType;

      return matchSearch && matchJob && matchType;
    });
  }, [reagents, searchTerm, selectedJobType, selectedReagentType]);

  const isPowerUser = user?.role === 'Admin' || user?.role === 'Manager';

  if (loading && reagents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-blue-600" size={48} />
        <p className="text-gray-500 animate-pulse font-black text-xs uppercase tracking-widest">
          Loading inventory overview...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-3">
            LabStock <span className="text-gray-400 font-normal">/</span>{' '}
            <span className="bg-[#e7f0ff] text-[#166ee1] px-3 py-1 rounded-lg text-xl">Inventory Overview</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1 font-medium">
            View total stock by item, then open each item to inspect lot-level detail in one flow.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => setReportModalOpen(true)}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#166ee1] text-white hover:bg-[#1259b3] transition-all font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-blue-100"
          >
            <FileText size={16} />
            Daily Report
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-600">
          <AlertTriangle size={20} />
          <p className="text-xs font-bold">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 ${stat.bg} ${stat.color} rounded-2xl flex items-center justify-center`}>
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

      <div className="bg-white border border-gray-100 rounded-[2rem] flex flex-col overflow-hidden shadow-sm">
        <div className="p-6 border-b border-gray-50 space-y-4">
          <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-6 bg-[#166ee1] rounded-full" />
              <h2 className="text-lg font-black text-gray-800 uppercase tracking-tight">Current Inventory</h2>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Search item name or ID..."
                className="w-full pl-11 pr-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:bg-white border-transparent focus:border-blue-100 outline-none transition-all shadow-inner"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-2 shrink-0">Job:</span>
              {jobTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedJobType(type)}
                  className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shrink-0 border ${
                    selectedJobType === type
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-100'
                      : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-2 shrink-0">Type:</span>
              {reagentTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedReagentType(type)}
                  className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shrink-0 border ${
                    selectedReagentType === type
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto max-h-[680px] no-scrollbar">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-gray-50/50 sticky top-0 z-10 border-b border-gray-100">
                <th className="px-6 md:px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.1em]">Name & ID</th>
                <th className="px-6 md:px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.1em]">Job / Type</th>
                <th className="px-6 md:px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.1em]">Lot Preview</th>
                <th className="px-6 md:px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.1em] text-center">Total Stock</th>
                <th className="px-6 md:px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.1em] text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-400 font-bold">
                    No inventory items found.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isLow = item.quantity <= item.minThreshold;

                  return (
                    <tr
                      key={item.itemId}
                      onClick={() => setSelectedReagent(item)}
                      className="hover:bg-blue-50/20 transition-colors group cursor-pointer"
                    >
                      <td className="px-6 md:px-8 py-5">
                        <p className="text-sm font-black text-gray-900 group-hover:text-[#166ee1] transition-colors line-clamp-1">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold mt-0.5 uppercase tracking-tighter">
                          Record ID: {item.itemId}
                        </p>
                      </td>
                      <td className="px-6 md:px-8 py-5">
                        <p className="text-sm font-bold text-gray-700">{item.jobType || '-'}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">
                          {item.reagentType || '-'}
                        </p>
                      </td>
                      <td className="px-6 md:px-8 py-5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.lots?.slice(0, 4).map((lot) => {
                            const isExpired = new Date(lot.expDate) < new Date();
                            return (
                              <span
                                key={`${item.itemId}-${lot.lotNo}`}
                                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[10px] font-black border ${
                                  isExpired
                                    ? 'bg-red-50 text-red-600 border-red-100'
                                    : 'bg-green-50 text-green-600 border-green-100'
                                }`}
                              >
                                <span className={`w-2 h-2 rounded-full ${isExpired ? 'bg-red-500' : 'bg-green-500'}`} />
                                {lot.lotNo}
                              </span>
                            );
                          })}
                          {item.lots.length > 4 && (
                            <span className="text-[10px] font-black text-gray-400 uppercase">
                              +{item.lots.length - 4} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-5 text-center">
                        <p className="text-lg font-black text-gray-900">
                          {item.quantity}{' '}
                          <span className="text-[10px] font-bold text-gray-400 uppercase">{item.unit}</span>
                        </p>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tight ${
                            isLow
                              ? 'bg-red-50 text-red-600 border border-red-100'
                              : 'bg-green-50 text-green-600 border border-green-100'
                          }`}
                        >
                          {isLow ? 'Low Stock' : 'Operational'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ReportModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        data={reagents}
        jobTypes={jobTypes.filter((type) => type !== 'All')}
      />

      <ReagentDetailModal
        key={selectedReagent?.itemId ?? 'empty'}
        isOpen={!!selectedReagent}
        onClose={() => setSelectedReagent(null)}
        reagent={selectedReagent}
        canReconcile={isPowerUser}
        onInventoryUpdated={async () => {
          setSelectedReagent(null);
          await fetchData();
        }}
      />
    </div>
  );
}
