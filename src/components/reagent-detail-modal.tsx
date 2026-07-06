'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Clock,
  Cpu,
  Edit2,
  Factory,
  Loader2,
  Package,
  Tag,
} from 'lucide-react';
import { apiClient, Lot, Reagent } from '@/lib/api-client';
import Modal from '@/components/modal';

interface ReagentDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  reagent: Reagent | null;
  canReconcile?: boolean;
  onInventoryUpdated?: () => Promise<void> | void;
}

export default function ReagentDetailModal({
  isOpen,
  onClose,
  reagent,
  canReconcile = false,
  onInventoryUpdated,
}: ReagentDetailModalProps) {
  const [editingLot, setEditingLot] = useState<Lot | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!reagent) return null;

  const isLow = reagent.quantity <= reagent.minThreshold;
  const now = new Date();
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);

  const handleReconcile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingLot) return;

    const formData = new FormData(event.currentTarget);
    const newLotNo = String(formData.get('lotNo') || '').trim();
    const newExpDate = String(formData.get('expDate') || '').trim();
    const newQty = Number(formData.get('newQty'));

    if (!newLotNo) {
      alert('กรุณากรอก Lot Number');
      return;
    }

    try {
      setSubmitting(true);
      const result = await apiClient.reconcileInventory({
        itemId: reagent.itemId,
        currentLotNo: editingLot.lotNo,
        newLotNo,
        newExpDate,
        newQty,
      });

      if (!result.success) {
        alert(result.error || 'Unable to update inventory.');
        return;
      }

      setEditingLot(null);
      await onInventoryUpdated?.();
    } catch (error: unknown) {
      const appError = error as { response?: { data?: { error?: string } }; message?: string };
      alert(appError.response?.data?.error || appError.message || 'Unable to update inventory.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reagent Insights" maxWidth="max-w-2xl">
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div
            className={`w-20 h-20 rounded-3xl flex items-center justify-center shrink-0 shadow-sm border ${
              isLow ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600 border-blue-100'
            }`}
          >
            <Package size={40} />
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-black text-gray-900 leading-tight">{reagent.name}</h3>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-[10px] font-black uppercase tracking-wider border border-gray-200">
                ID: {reagent.itemId}
              </span>
              <span
                className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                  isLow
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : 'bg-green-100 text-green-700 border-green-200'
                }`}
              >
                {isLow ? 'Low Stock' : 'Operational'}
              </span>
            </div>
          </div>
        </div>

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

        <div className="bg-gray-900 rounded-[2rem] p-8 text-white flex flex-col md:flex-row justify-between items-center gap-6 shadow-xl">
          <div className="text-center md:text-left">
            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-1">Live Quantity</p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-black">{reagent.quantity}</span>
              <span className="text-xs font-bold text-gray-400 uppercase">{reagent.unit}</span>
            </div>
          </div>
          <div className="h-px w-full md:w-px md:h-12 bg-gray-800" />
          <div className="text-center md:text-right">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Min Threshold</p>
            <div className="flex items-baseline gap-2 justify-center md:justify-end">
              <span className="text-2xl font-black">{reagent.minThreshold}</span>
              <span className="text-xs font-bold text-gray-500 uppercase">{reagent.unit}</span>
            </div>
          </div>
        </div>

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
                  {canReconcile && <th className="px-6 py-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {reagent.lots && reagent.lots.length > 0 ? (
                  reagent.lots.map((lot) => {
                    const expDate = new Date(lot.expDate);
                    const isExpired = expDate < now;
                    const isNear = expDate < thirtyDays && !isExpired;

                    return (
                      <tr key={`${reagent.itemId}-${lot.lotNo}`} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 font-bold text-gray-900">{lot.lotNo}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isExpired ? 'bg-red-500' : isNear ? 'bg-orange-500' : 'bg-green-500'
                              }`}
                            />
                            <span
                              className={`font-medium ${
                                isExpired
                                  ? 'text-red-600 font-bold'
                                  : isNear
                                    ? 'text-orange-600 font-bold'
                                    : 'text-gray-600'
                              }`}
                            >
                              {lot.expDate}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-black text-gray-900">{lot.qty}</td>
                        {canReconcile && (
                          <td className="px-6 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => setEditingLot(lot)}
                              className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-all font-bold text-xs border border-amber-200"
                            >
                              <Edit2 size={14} />
                              Adjust
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={canReconcile ? 4 : 3} className="px-6 py-10 text-center text-gray-400 font-bold">
                      No active batches found in inventory.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {canReconcile && editingLot && (
          <form onSubmit={handleReconcile} className="space-y-4 border border-blue-100 bg-blue-50 rounded-[2rem] p-6">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Inventory Reconciliation</p>
              <h4 className="text-lg font-black text-blue-900">{reagent.name}</h4>
              <p className="text-xs font-bold text-blue-700">
                Lot {editingLot.lotNo} | Current Qty {editingLot.qty} {reagent.unit}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-700 uppercase tracking-widest">Lot Number</label>
              <input
                name="lotNo"
                type="text"
                required
                defaultValue={editingLot.lotNo}
                className="w-full border border-blue-200 rounded-2xl px-4 py-3 font-bold text-gray-800 focus:bg-white transition outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-700 uppercase tracking-widest">Expiry Date</label>
              <input
                name="expDate"
                type="date"
                defaultValue={editingLot.expDate || ''}
                className="w-full border border-blue-200 rounded-2xl px-4 py-3 font-bold text-gray-800 focus:bg-white transition outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-700 uppercase tracking-widest">Actual Quantity</label>
              <input
                name="newQty"
                type="number"
                required
                min="0"
                step="any"
                autoFocus
                defaultValue={editingLot.qty}
                className="w-full border-2 border-blue-600 rounded-[1.5rem] px-6 py-4 text-center font-black text-3xl text-blue-600 focus:bg-white transition outline-none"
              />
            </div>

            <p className="text-xs text-amber-700 font-bold bg-amber-50 p-3 rounded-xl border border-amber-100">
              <AlertTriangle size={14} className="inline mr-1" />
              This updates lot, expiry, and quantity immediately, then writes an adjustment log.
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditingLot(null)}
                className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 rounded-2xl hover:bg-gray-50 transition-all font-bold text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all shadow-lg font-black text-sm uppercase flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={18} className="animate-spin" />}
                Save Changes
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
