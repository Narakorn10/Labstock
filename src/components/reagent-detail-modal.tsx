'use client';

import { X, Package, Clock, AlertTriangle, Boxes, Tag, Cpu, Factory } from 'lucide-react';
import { Reagent, Lot } from '@/lib/api-client';
import Modal from '@/components/modal';

interface ReagentDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  reagent: Reagent | null;
}

export default function ReagentDetailModal({ isOpen, onClose, reagent }: ReagentDetailModalProps) {
  if (!reagent) return null;

  const isLow = reagent.quantity <= reagent.minThreshold;
  const now = new Date();
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Reagent Insights" 
      maxWidth="max-w-2xl"
    >
      <div className="space-y-8">
        {/* Header Info */}
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center shrink-0 shadow-sm border ${isLow ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
            <Package size={40} />
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-black text-gray-900 leading-tight">{reagent.name}</h3>
            <div className="flex flex-wrap gap-2 pt-1">
                <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-[10px] font-black uppercase tracking-wider border border-gray-200">ID: {reagent.itemId}</span>
                <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${isLow ? 'bg-red-100 text-red-700 border-red-200 animate-pulse' : 'bg-green-100 text-green-700 border-green-200'}`}>
                    {isLow ? 'Low Stock' : 'Operational'}
                </span>
            </div>
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                    <Tag size={14} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Type</span>
                </div>
                <p className="text-sm font-bold text-gray-800">{reagent.reagentType || '-'}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                    <Boxes size={14} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Job</span>
                </div>
                <p className="text-sm font-bold text-gray-800">{reagent.jobType || '-'}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                    <Cpu size={14} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Machine</span>
                </div>
                <p className="text-sm font-bold text-gray-800">{reagent.machineType || '-'}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                    <Factory size={14} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Vendor</span>
                </div>
                <p className="text-sm font-bold text-gray-800">{reagent.vendor || '-'}</p>
            </div>
        </div>

        {/* Stock Status */}
        <div className="bg-gray-900 rounded-[2rem] p-8 text-white flex flex-col md:flex-row justify-between items-center gap-6 shadow-xl">
            <div className="text-center md:text-left">
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-1">Live Quantity</p>
                <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black">{reagent.quantity}</span>
                    <span className="text-xs font-bold text-gray-400 uppercase">{reagent.unit}</span>
                </div>
            </div>
            <div className="h-px w-full md:w-px md:h-12 bg-gray-800"></div>
            <div className="text-center md:text-right">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Min Threshold</p>
                <div className="flex items-baseline gap-2 justify-center md:justify-end">
                    <span className="text-2xl font-black">{reagent.minThreshold}</span>
                    <span className="text-xs font-bold text-gray-500 uppercase">{reagent.unit}</span>
                </div>
            </div>
        </div>

        {/* Batch List */}
        <div className="space-y-4">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Clock size={16} className="text-blue-600" />
                Active Inventory Batches (FEFO Order)
            </h4>
            <div className="overflow-hidden rounded-2xl border border-gray-100">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 font-black uppercase text-[10px] tracking-widest">
                        <tr>
                            <th className="px-6 py-3">Lot Number</th>
                            <th className="px-6 py-3">Expiry Date</th>
                            <th className="px-6 py-3 text-right">Qty</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {reagent.lots && reagent.lots.length > 0 ? (
                            reagent.lots.map((lot, idx) => {
                                const expDate = new Date(lot.expDate);
                                const isExpired = expDate < now;
                                const isNear = expDate < thirtyDays && !isExpired;

                                return (
                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 font-bold text-gray-900">{lot.lotNo}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${isExpired ? 'bg-red-500' : isNear ? 'bg-orange-500' : 'bg-green-500'}`} />
                                                <span className={`font-medium ${isExpired ? 'text-red-600 font-bold' : isNear ? 'text-orange-600 font-bold' : 'text-gray-600'}`}>
                                                    {lot.expDate}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right font-black text-gray-900">{lot.qty}</td>
                                    </tr>
                                )
                            })
                        ) : (
                            <tr>
                                <td colSpan={3} className="px-6 py-10 text-center text-gray-400 font-bold">No active batches found in inventory.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
      </div>
    </Modal>
  );
}
