'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import Modal from '@/components/modal';
import { BarcodePattern, Lot, Reagent } from '@/lib/api-client';
import { findMatchingReagent } from '@/lib/barcode-parser';
import QRScanner from '@/components/qr-scanner';
import {
  ArrowLeft,
  Calendar,
  Camera,
  CheckCircle,
  HandHelping,
  Loader2,
  PackagePlus,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';

type WorkflowMode = 'receive' | 'dispense';

interface MobileStockWorkflowProps {
  mode: WorkflowMode;
}

interface MobileCartItem {
  cartId: string;
  itemId: string;
  name: string;
  lotNo: string;
  qty: number;
  unit: string;
  expDate: string;
  maxQty?: number;
  availableLots?: Lot[];
}

interface MobileLookupResponse {
  reagents: Reagent[];
  patterns: BarcodePattern[];
}

const createCartId = (itemId: string) => `${itemId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function MobileStockWorkflow({ mode }: MobileStockWorkflowProps) {
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<MobileCartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approverUsername, setApproverUsername] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [confirmError, setConfirmError] = useState('');

  const isReceive = mode === 'receive';

  const loadLookupData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/mobile/lookup');
      const data = await response.json() as MobileLookupResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || 'Unable to load mobile workflow data');
      }

      setReagents(data.reagents);
      setPatterns(data.patterns);
    } catch (err: unknown) {
      console.error(err);
      const error = err as { message?: string };
      setLoadError(error.message || 'Unable to load mobile workflow data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadLookupData);
  }, [loadLookupData]);

  const filteredResults = useMemo(() => {
    if (!search.trim()) return [];
    return reagents
      .filter((reagent) =>
        reagent.name.toLowerCase().includes(search.toLowerCase()) ||
        reagent.itemId.toLowerCase().includes(search.toLowerCase()) ||
        (reagent.qrCode || '').toLowerCase().includes(search.toLowerCase())
      )
      .slice(0, 6);
  }, [search, reagents]);

  const addReceiveItem = (match: Reagent, lotNo: string = '', expDate: string = '') => {
    const newItem: MobileCartItem = {
      cartId: createCartId(match.itemId),
      itemId: match.itemId,
      name: match.name,
      lotNo,
      expDate,
      qty: 1,
      unit: match.unit,
    };

    setCart((prev) => {
      const existing = prev.find((item) => item.itemId === newItem.itemId && item.lotNo === newItem.lotNo);
      if (existing) {
        return prev.map((item) => (item.cartId === existing.cartId ? { ...item, qty: item.qty + 1 } : item));
      }
      return [newItem, ...prev];
    });

    setFeedback({ type: 'success', msg: `Added ${match.name} to receive queue.` });
  };

  const addDispenseItem = (match: Reagent, lotOverride?: string) => {
    if (match.lots.length === 0) {
      setFeedback({ type: 'error', msg: `No available stock for ${match.name}.` });
      return;
    }

    const sortedLots = [...match.lots].sort(
      (a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime()
    );
    let selectedLot = sortedLots[0];

    if (lotOverride) {
      const exactLot = sortedLots.find((lot) => lot.lotNo.toLowerCase() === lotOverride.toLowerCase());
      if (exactLot) selectedLot = exactLot;
    }

    const newItem: MobileCartItem = {
      cartId: createCartId(match.itemId),
      itemId: match.itemId,
      name: match.name,
      lotNo: selectedLot.lotNo,
      expDate: selectedLot.expDate,
      qty: 1,
      unit: match.unit,
      maxQty: selectedLot.qty,
      availableLots: sortedLots,
    };

    setCart((prev) => {
      const existing = prev.find((item) => item.itemId === newItem.itemId && item.lotNo === newItem.lotNo);
      if (existing) {
        return prev.map((item) =>
          item.cartId === existing.cartId
            ? { ...item, qty: Math.min(item.qty + 1, item.maxQty || item.qty + 1) }
            : item
        );
      }
      return [newItem, ...prev];
    });

    setFeedback({ type: 'success', msg: `Added ${match.name} (${selectedLot.lotNo}) to dispense queue.` });
  };

  const addToCart = useCallback(
    (match: Reagent, lotNo?: string, expDate?: string) => {
      if (isReceive) {
        addReceiveItem(match, lotNo || '', expDate || '');
      } else {
        addDispenseItem(match, lotNo);
      }

      setSearch('');
      setShowResults(false);
    },
    [isReceive]
  );

  const handleScan = useCallback(
    (decodedText: string) => {
      const { data, match, lookupValues } = findMatchingReagent(decodedText, patterns, reagents);
      if (!data) {
        setFeedback({ type: 'error', msg: 'Could not read this barcode.' });
        setScanMode(false);
        return;
      }

      if (!match) {
        const parsedId = data.gtin || data.rawString || '-';
        const parsedLot = data.lot === 'NEED_MANUAL_INPUT' ? '-' : data.lot;
        setFeedback({
          type: 'error',
          msg: `No reagent match found. code: ${parsedId} | lot: ${parsedLot} | keys: ${lookupValues.join(', ') || '-'}`,
        });
        setScanMode(false);
        return;
      }

      addToCart(
        match,
        data.lot === 'NEED_MANUAL_INPUT' ? '' : data.lot,
        data.expDate === 'NEED_MANUAL_INPUT' ? '' : data.expDate
      );
      setScanMode(false);
    },
    [addToCart, patterns, reagents]
  );

  const handleManualAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (filteredResults.length === 1) {
      addToCart(filteredResults[0]);
    } else {
      handleScan(search);
    }
  };

  const removeFromCart = (cartId: string) => {
    setCart((prev) => prev.filter((item) => item.cartId !== cartId));
  };

  const updateQty = (cartId: string, newQty: string) => {
    const parsedQty = parseInt(newQty, 10) || 0;
    setCart((prev) =>
      prev.map((item) => {
        if (item.cartId !== cartId) return item;
        const limitedQty = isReceive ? parsedQty : Math.min(parsedQty, item.maxQty || parsedQty);
        return { ...item, qty: limitedQty };
      })
    );
  };

  const updateReceiveField = (cartId: string, field: 'lotNo' | 'expDate', value: string) => {
    setCart((prev) => prev.map((item) => (item.cartId === cartId ? { ...item, [field]: value } : item)));
  };

  const updateDispenseLot = (cartId: string, selectedLotNo: string) => {
    setCart((prev) => {
      const currentItem = prev.find((item) => item.cartId === cartId);
      if (!currentItem?.availableLots) return prev;

      const selectedLot = currentItem.availableLots.find((lot) => lot.lotNo === selectedLotNo);
      if (!selectedLot) return prev;

      const duplicateItem = prev.find(
        (item) =>
          item.cartId !== cartId &&
          item.itemId === currentItem.itemId &&
          item.lotNo === selectedLot.lotNo
      );

      if (duplicateItem) {
        return prev
          .filter((item) => item.cartId !== cartId)
          .map((item) =>
            item.cartId === duplicateItem.cartId
              ? { ...item, qty: Math.min(item.qty + currentItem.qty, item.maxQty || item.qty + currentItem.qty) }
              : item
          );
      }

      return prev.map((item) =>
        item.cartId === cartId
          ? {
              ...item,
              lotNo: selectedLot.lotNo,
              expDate: selectedLot.expDate,
              maxQty: selectedLot.qty,
              qty: Math.min(item.qty, selectedLot.qty),
            }
          : item
      );
    });
  };

  const openConfirm = () => {
    const validItems = cart.filter((item) => item.qty > 0);
    if (validItems.length === 0) {
      setFeedback({ type: 'error', msg: 'Please enter a quantity greater than 0.' });
      return;
    }

    setConfirmError('');
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    const validItems = cart.filter((item) => item.qty > 0);

    if (validItems.length === 0) {
      setConfirmError('Please enter a quantity greater than 0.');
      return;
    }

    if (!approverUsername.trim() || !approverPin.trim()) {
      setConfirmError('Username and PIN are required.');
      return;
    }

    setSubmitting(true);
    setConfirmError('');

    try {
      const response = await fetch('/api/mobile/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          username: approverUsername.trim(),
          pin: approverPin.trim(),
          batchItems: validItems,
        }),
      });

      const result = await response.json() as { error?: string; approver?: { name: string; role: string } };
      if (!response.ok) {
        throw new Error(result.error || 'Request failed.');
      }

      setFeedback({
        type: 'success',
        msg: isReceive
          ? `Received ${validItems.length} item(s). Approved by ${result.approver?.name || approverUsername}.`
          : `Dispensed ${validItems.length} item(s). Approved by ${result.approver?.name || approverUsername}.`,
      });
      setCart([]);
      setApproverPin('');
      setConfirmOpen(false);
      await loadLookupData();
    } catch (err: unknown) {
      const error = err as { message?: string };
      setConfirmError(error.message || 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const pageTitle = isReceive ? 'Mobile Receive' : 'Mobile Dispense';
  const pageDescription = isReceive
    ? 'Scanner-first receive flow with large controls and quick lot entry.'
    : 'Scanner-first dispense flow with FEFO default and quick lot selection.';

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6">
        <Loader2 className="animate-spin text-blue-600" size={42} />
        <p className="text-sm font-bold text-gray-500">Loading mobile workflow...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7f9]">
      <div className="max-w-md mx-auto px-4 py-4 pb-28 space-y-4">
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-4 space-y-4 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <Link href="/mobile" className="w-11 h-11 rounded-2xl bg-gray-100 text-gray-700 flex items-center justify-center">
              <ArrowLeft size={20} />
            </Link>
            <div className="text-right">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Scanner First</p>
              <h1 className="text-xl font-black text-gray-900">{pageTitle}</h1>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Link
              href="/mobile/receive"
              className={`h-12 rounded-2xl text-sm font-black flex items-center justify-center ${
                isReceive ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              Receive
            </Link>
            <Link
              href="/mobile/dispense"
              className={`h-12 rounded-2xl text-sm font-black flex items-center justify-center ${
                !isReceive ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              Dispense
            </Link>
          </div>

          <p className="text-xs font-medium text-gray-500">{pageDescription}</p>
        </div>

        {feedback && (
          <div
            className={`p-4 rounded-[1.5rem] border flex items-center gap-3 ${
              feedback.type === 'success'
                ? 'bg-green-50 text-green-700 border-green-100'
                : 'bg-red-50 text-red-700 border-red-100'
            }`}
          >
            {feedback.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
            <p className="text-sm font-bold flex-1">{feedback.msg}</p>
            <button onClick={() => setFeedback(null)} className="text-xs font-black uppercase">
              Close
            </button>
          </div>
        )}

        {loadError && (
          <div className="p-4 rounded-[1.5rem] bg-red-50 border border-red-100 text-red-700 text-sm font-bold">
            {loadError}
          </div>
        )}

        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-4 space-y-3">
          <button
            onClick={() => setScanMode(true)}
            className={`w-full h-16 rounded-[1.5rem] font-black text-base text-white flex items-center justify-center gap-3 ${
              isReceive ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            <Camera size={22} />
            Scan Barcode
          </button>

          <form onSubmit={handleManualAdd} className="space-y-3">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="Type item ID, name, or barcode..."
                className="w-full h-14 pl-11 pr-4 rounded-2xl border border-gray-200 bg-gray-50 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
              />
              {showResults && filteredResults.length > 0 && (
                <div className="absolute z-10 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden">
                  {filteredResults.map((item) => (
                    <button
                      key={item.itemId}
                      type="button"
                      onClick={() => addToCart(item)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-none"
                    >
                      <p className="text-sm font-black text-gray-900">{item.name}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase">ID: {item.itemId}</p>
                    </button>
                  ))}
                </div>
              )}
              {showResults && <div className="fixed inset-0 z-0" onClick={() => setShowResults(false)} />}
            </div>
            <button type="submit" className="w-full h-12 rounded-2xl bg-slate-900 text-white text-sm font-black">
              Add Manually
            </button>
          </form>
        </div>

        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Queue</p>
              <h2 className="text-lg font-black text-gray-900">{cart.length} item(s)</h2>
            </div>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs font-black uppercase text-red-500">
                Clear
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="rounded-[1.5rem] border-2 border-dashed border-gray-100 bg-gray-50 p-8 text-center">
              {isReceive ? <PackagePlus className="mx-auto text-gray-300 mb-3" size={40} /> : <HandHelping className="mx-auto text-gray-300 mb-3" size={40} />}
              <p className="text-sm font-bold text-gray-400">Scan or search to start.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.map((item) => (
                <div key={item.cartId} className="rounded-[1.5rem] border border-gray-100 bg-gray-50 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-black text-gray-900 truncate">{item.name}</h3>
                      <p className="text-[10px] font-bold text-gray-400 uppercase">ID: {item.itemId}</p>
                    </div>
                    <button onClick={() => removeFromCart(item.cartId)} className="w-10 h-10 rounded-2xl bg-white text-gray-400 flex items-center justify-center">
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {isReceive ? (
                    <div className="grid grid-cols-1 gap-3">
                      <input
                        type="text"
                        value={item.lotNo}
                        onChange={(e) => updateReceiveField(item.cartId, 'lotNo', e.target.value)}
                        placeholder="Lot number"
                        className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="date"
                        value={item.expDate}
                        onChange={(e) => updateReceiveField(item.cartId, 'expDate', e.target.value)}
                        className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Lot</label>
                      <select
                        value={item.lotNo}
                        onChange={(e) => updateDispenseLot(item.cartId, e.target.value)}
                        className="w-full h-12 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-red-500"
                      >
                        {item.availableLots?.map((lot) => (
                          <option key={`${item.itemId}-${lot.lotNo}`} value={lot.lotNo}>
                            {lot.lotNo}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] font-bold text-gray-500 flex items-center gap-2">
                        <Calendar size={12} />
                        EXP {item.expDate} | Max {item.maxQty} {item.unit}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      max={item.maxQty}
                      value={item.qty}
                      onChange={(e) => updateQty(item.cartId, e.target.value)}
                      className="flex-1 h-12 rounded-2xl border border-gray-200 bg-white px-4 text-center text-lg font-black text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="min-w-16 text-center">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Unit</p>
                      <p className="text-sm font-black text-gray-700">{item.unit}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-4">
          <div className="max-w-md mx-auto">
            <button
              onClick={openConfirm}
              disabled={submitting}
              className={`w-full h-16 rounded-[1.5rem] text-white font-black text-base flex items-center justify-center gap-3 ${
                isReceive ? 'bg-green-600' : 'bg-red-600'
              } disabled:opacity-50`}
            >
              {submitting ? <Loader2 size={22} className="animate-spin" /> : <CheckCircle size={22} />}
              {isReceive ? `Confirm Receive ${cart.length}` : `Confirm Dispense ${cart.length}`}
            </button>
          </div>
        </div>
      )}

      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (!submitting) {
            setConfirmOpen(false);
            setConfirmError('');
            setApproverPin('');
          }
        }}
        title={isReceive ? 'Approve Receive' : 'Approve Dispense'}
        maxWidth="max-w-md"
      >
        <div className="space-y-5">
          <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Approval Required</p>
            <p className="mt-2 text-sm font-medium text-gray-600">
              Enter a username and PIN to approve this {isReceive ? 'receive' : 'dispense'} transaction.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Username</label>
            <input
              type="text"
              value={approverUsername}
              onChange={(e) => setApproverUsername(e.target.value)}
              placeholder="e.g. staff01"
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={approverPin}
              onChange={(e) => setApproverPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="4-6 digits"
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          {confirmError && (
            <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm font-bold text-red-700">
              {confirmError}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={`w-full py-4 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
              isReceive ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {submitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
            Confirm with PIN
          </button>
        </div>
      </Modal>

      {scanMode && <QRScanner onScan={handleScan} onClose={() => setScanMode(false)} />}
    </div>
  );
}
