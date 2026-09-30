'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiClient, BarcodePattern, Lot, Reagent } from '@/lib/api-client';
import { findMatchingReagentWithV2 } from '@/lib/barcode-parser';
import QRScanner from '@/components/lazy-qr-scanner';
import {
  Camera,
  Trash2,
  Loader2,
  CheckCircle,
  X,
} from 'lucide-react';

interface CartItem {
  cartId: string;
  inventoryId: number;
  itemId: string;
  name: string;
  lotNo: string;
  qty: number;
  unit: string;
  maxQty: number;
  expDate: string;
  receivedOn: string;
  availableLots: Lot[];
}

export default function DispensePage() {
  const { user, loading: authLoading } = useAuth();
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [v2Patterns, setV2Patterns] = useState<import('@/lib/api-client').BarcodePatternV2Runtime[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('ALL');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const cartIdRef = useRef(0);

  const formatThaiDate = (value?: string) => {
    if (!value) return '-';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString('th-TH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const createCartId = (itemId: string) => {
    cartIdRef.current += 1;
    return `${itemId}-${cartIdRef.current}`;
  };

  const loadLookupData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [reagentsData, runtimeData] = await Promise.all([
        apiClient.getDashboard(),
        apiClient.getBarcodeRuntimePatterns()
      ]);
      setReagents(reagentsData);
      setPatterns(runtimeData.patterns);
      setV2Patterns(runtimeData.v2Patterns);
    } catch (err: unknown) {
      console.error(err);
      const error = err as { response?: { data?: { error?: string } }, message?: string };
      setLoadError(error.response?.data?.error || error.message || 'ไม่สามารถโหลดข้อมูลสำหรับค้นหาได้');
    } finally {
      setLoading(false);
    }
  };

  // Load reagents for lookup
  useEffect(() => {
    let active = true;

    const fetchInitialLookupData = async () => {
      if (authLoading) {
        return;
      }

      if (!user) {
        return;
      }

      try {
        const [reagentsData, runtimeData] = await Promise.all([
          apiClient.getDashboard(),
          apiClient.getBarcodeRuntimePatterns()
        ]);

        if (!active) {
          return;
        }

        setReagents(reagentsData);
        setPatterns(runtimeData.patterns);
        setV2Patterns(runtimeData.v2Patterns);
      } catch (err: unknown) {
        if (!active) {
          return;
        }

        console.error(err);
        const error = err as { response?: { data?: { error?: string } }, message?: string };
        setLoadError(error.response?.data?.error || error.message || 'ไม่สามารถโหลดข้อมูลสำหรับค้นหาได้');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchInitialLookupData();

    return () => {
      active = false;
    };
  }, [authLoading, user]);

  const addToCart = (match: Reagent, lotOverride?: string) => {
    if (match.lots.length === 0) {
      setFeedback({ type: 'error', msg: `ไม่พบสต๊อกสำหรับ ${match.name}` });
      return;
    }

    const sortedLots = [...match.lots].sort((a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime());
    let selectedLot = sortedLots[0];

    if (lotOverride) {
      const exactLot = sortedLots.find(l => l.lotNo.toLowerCase() === lotOverride.toLowerCase());
      if (exactLot) selectedLot = exactLot;
    }

    const newItem: CartItem = {
      cartId: createCartId(match.itemId),
      inventoryId: selectedLot.inventoryId,
      itemId: match.itemId,
      name: match.name,
      lotNo: selectedLot.lotNo,
      expDate: selectedLot.expDate,
      receivedOn: selectedLot.receivedOn,
      qty: 1,
      unit: match.unit,
      maxQty: selectedLot.qty,
      availableLots: sortedLots
    };

    setCart(prev => {
      const existing = prev.find(i => i.inventoryId === newItem.inventoryId);
      if (existing) {
        const updatedQty = Math.min(existing.qty + 1, existing.maxQty);
        return prev.map(i => i === existing ? { ...i, qty: updatedQty } : i);
      }
      return [newItem, ...prev];
    });

    setSearch('');
    setShowResults(false);
    setFeedback({ type: 'success', msg: `เพิ่ม ${match.name} (ล็อต ${selectedLot.lotNo}) ลงตะกร้าแล้ว` });
  };

  const handleScan = (decodedText: string) => {
    const { data, match, lookupValues } = findMatchingReagentWithV2(decodedText, patterns, v2Patterns, reagents, v2Patterns.length > 0);
    if (!data) {
      setFeedback({ type: 'error', msg: 'ไม่สามารถอ่าน QR/Barcode นี้ได้ กรุณาลองใหม่' });
      setScanMode(false);
      return;
    }

    if (match) {
      addToCart(match, data.lot === 'NEED_MANUAL_INPUT' ? undefined : data.lot);
      setScanMode(false);
    } else {
      const parsedId = data.gtin || data.rawString || '-';
      const parsedLot = data.lot === 'NEED_MANUAL_INPUT' ? '-' : data.lot;
      setFeedback({ type: 'error', msg: `ไม่พบข้อมูลในระบบ | รหัส: ${parsedId} | ล็อต: ${parsedLot} | คำค้น: ${lookupValues.join(', ') || '-'}` });
      setScanMode(false);
    }
  };

  const filteredResults = useMemo(() => {
    if (!search.trim()) return [];
    return reagents.filter(r =>
      (vendorFilter === 'ALL' || r.vendor === vendorFilter) && (
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.itemId.toLowerCase().includes(search.toLowerCase()) ||
        (r.qrCode || '').toLowerCase().includes(search.toLowerCase())
      )
    ).slice(0, 5);
  }, [search, reagents, vendorFilter]);

  const vendorOptions = useMemo(
    () => Array.from(new Set(reagents.map(r => r.vendor).filter((vendor): vendor is string => Boolean(vendor)))).sort(),
    [reagents],
  );

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (filteredResults.length === 1) {
      addToCart(filteredResults[0]);
    } else {
      handleScan(search);
    }
  };

  const removeFromCart = (cartId: string) => {
    setCart(prev => prev.filter(item => item.cartId !== cartId));
  };

  const updateQty = (cartId: string, newQty: string) => {
    const val = parseInt(newQty) || 0;
    setCart(prev => prev.map((item) => {
      if (item.cartId === cartId) {
        const finalQty = Math.min(val, item.maxQty);
        return { ...item, qty: finalQty };
      }
      return item;
    }));
  };

  const updateLotSelection = (cartId: string, selectedInventoryId: string) => {
    setCart(prev => {
      const currentItem = prev.find(item => item.cartId === cartId);
      if (!currentItem) return prev;

      const selectedLot = currentItem.availableLots.find(lot => String(lot.inventoryId) === selectedInventoryId);
      if (!selectedLot) return prev;

      const duplicateItem = prev.find(item =>
        item.cartId !== cartId &&
        item.inventoryId === selectedLot.inventoryId
      );

      if (duplicateItem) {
        return prev
          .filter(item => item.cartId !== cartId)
          .map(item => item.cartId === duplicateItem.cartId
            ? {
                ...item,
                qty: Math.min(item.qty + currentItem.qty, item.maxQty)
              }
            : item
          );
      }

      return prev.map(item => {
        if (item.cartId !== cartId) return item;

        return {
          ...item,
          inventoryId: selectedLot.inventoryId,
          lotNo: selectedLot.lotNo,
          expDate: selectedLot.expDate,
          receivedOn: selectedLot.receivedOn,
          maxQty: selectedLot.qty,
          qty: Math.min(item.qty, selectedLot.qty)
        };
      });
    });
  };

  const handleSubmit = async () => {
    // Filter out items with 0 or negative quantity
    const validItems = cart.filter(item => item.qty > 0);
    
    if (validItems.length === 0) {
      setFeedback({ type: 'error', msg: 'กรุณาระบุจำนวนที่ต้องการเบิก (ต้องมากกว่า 0)' });
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.dispenseBatch(validItems);
      setFeedback({ type: 'success', msg: 'บันทึกรายการเบิกจ่ายเรียบร้อยแล้ว' });
      setCart([]);
      await loadLookupData();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }, message: string };
      setFeedback({ type: 'error', msg: 'เกิดข้อผิดพลาด: ' + (error.response?.data?.error || error.message) });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || (user && loading)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-red-600" size={48} />
        <p className="text-gray-500 animate-pulse">กำลังโหลดข้อมูลสต๊อก...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const totalQty = cart.reduce((sum, item) => sum + (item.qty > 0 ? item.qty : 0), 0);
  const fieldClass = 'min-h-[38px] w-full rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10';
  const cellClass = 'border-b border-line px-3.5 py-3 align-middle text-sm';
  const headClass = 'bg-ground px-3.5 py-2.5 text-left text-[13px] font-medium text-gray-600';
  // FEFO suggestion = the lot that expires first among lots that have not expired yet.
  const fefoLotId = (item: CartItem) => {
    const usable = item.availableLots
      .filter((lot) => new Date(lot.expDate) >= new Date())
      .sort((a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime());
    return usable[0]?.inventoryId;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-[32px] leading-tight font-medium text-ink">เบิกไปหน้างาน</h1>
        <p className="mt-1.5 text-[15px] text-gray-600">ตัดสต๊อกด้วยระบบ FEFO (แนะนำ Lot ที่หมดอายุก่อนอัตโนมัติ)</p>
      </div>

      {loadError && (
        <div role="alert" className="rounded-xl bg-crit-bg px-3.5 py-3 text-sm font-medium text-crit">
          โหลดข้อมูลไม่สำเร็จ: {loadError}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Action Area */}
        <section aria-labelledby="dispense-scan-heading" className="flex min-w-0 flex-col gap-3.5 rounded-2xl border border-line bg-white p-5">
          <h2 id="dispense-scan-heading" className="text-lg font-medium">สแกน / ค้นหา</h2>
          <button
            type="button"
            onClick={() => setScanMode(true)}
            className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-ink bg-ink px-[18px] py-4 text-base font-medium text-white transition hover:bg-black active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-800"
          >
            <Camera size={20} />
            เปิดกล้องแสกนเพื่อเบิก
          </button>

          <select
            aria-label="กรองตามบริษัท (Vendor)"
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            className="min-h-[38px] w-full cursor-pointer rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
          >
            <option value="ALL">ทุกบริษัท (Vendor)</option>
            {vendorOptions.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
          </select>

          <form onSubmit={handleManualAdd} className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="รหัสน้ำยา หรือ บาร์โค้ด..."
                aria-label="รหัสน้ำยา หรือ บาร์โค้ด"
                className={fieldClass}
              />

              {/* Autocomplete Results */}
              {showResults && filteredResults.length > 0 && (
                <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-line bg-white shadow-lg">
                  {filteredResults.map(item => (
                    <button
                      key={item.itemId}
                      type="button"
                      onClick={() => addToCart(item)}
                      className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-2.5 text-left last:border-none hover:bg-[#fafafa]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{item.name}</span>
                        <span className="block text-xs text-gray-600">รหัส: {item.itemId}</span>
                      </span>
                      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-gray-200 px-2.5 py-[3px] text-xs font-medium">คงเหลือ: {item.quantity}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Click away listener */}
              {showResults && (
                <div
                  className="fixed inset-0 z-0"
                  onClick={() => setShowResults(false)}
                />
              )}
            </div>
            <button type="submit" className="relative z-10 inline-flex items-center rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink transition hover:bg-gray-50">
              ค้นหา
            </button>
          </form>

          {/* Feedback */}
          {feedback && (
            <div role="status" className={`flex items-start gap-3 rounded-xl px-3.5 py-3 text-sm font-medium ${feedback.type === 'success' ? 'bg-ok-bg text-ok' : 'bg-crit-bg text-crit'}`}>
              <span className="flex-1">{feedback.msg}</span>
              <button type="button" onClick={() => setFeedback(null)} aria-label="ปิดข้อความ" className="opacity-70 hover:opacity-100"><X size={16} /></button>
            </div>
          )}
        </section>

        {/* Cart Area */}
        <section aria-labelledby="dispense-cart-heading" className="min-w-0 rounded-2xl border border-line bg-white p-5">
          <div className="mb-3 flex items-center">
            <h2 id="dispense-cart-heading" className="mr-auto text-lg font-medium">
              รายการเตรียมเบิก
              <span className="ml-1 inline-flex items-center rounded-full bg-gray-200 px-2.5 py-[3px] text-xs font-medium">{cart.length}</span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
              <caption className="sr-only">รายการเตรียมเบิก</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${headClass} rounded-l-[10px]`}>รายการ</th>
                  <th scope="col" className={`${headClass} w-[300px]`}>ล็อต</th>
                  <th scope="col" className={`${headClass} w-[90px]`}>จำนวน</th>
                  <th scope="col" className={`${headClass} w-11 rounded-r-[10px]`}><span className="sr-only">ลบ</span></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item) => (
                  <tr key={item.cartId}>
                    <td className={cellClass}>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-gray-600">
                        หมดอายุ: {new Date(item.expDate).toLocaleDateString('th-TH')} · คงเหลือในล็อต: {item.maxQty} {item.unit}
                      </div>
                    </td>
                    <td className={cellClass}>
                      <select
                        value={String(item.inventoryId)}
                        onChange={(e) => updateLotSelection(item.cartId, e.target.value)}
                        aria-label={`ล็อตของ ${item.name}`}
                        className={fieldClass}
                      >
                        {item.availableLots.map((lot) => (
                          <option key={lot.inventoryId} value={String(lot.inventoryId)}>
                            {`${lot.lotNo} | EXP ${formatThaiDate(lot.expDate)} | รับเข้า ${formatThaiDate(lot.receivedOn)}`}
                          </option>
                        ))}
                      </select>
                      {fefoLotId(item) === item.inventoryId && (
                        <div className="mt-0.5 text-[11px] font-medium text-ok">FEFO แนะนำ</div>
                      )}
                    </td>
                    <td className={cellClass}>
                      <input
                        type="number"
                        min="0"
                        value={item.qty}
                        max={item.maxQty}
                        onChange={(e) => updateQty(item.cartId, e.target.value)}
                        aria-label={`จำนวน (${item.unit}) ของ ${item.name}`}
                        className={`${fieldClass} font-semibold`}
                      />
                      <div className="text-[11px] text-gray-600">{item.unit}</div>
                    </td>
                    <td className={cellClass}>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.cartId)}
                        aria-label={`ลบ ${item.name}`}
                        className="inline-flex rounded-[10px] px-2 py-1.5 text-gray-700 hover:bg-gray-100 hover:text-crit"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cart.length === 0 && (
            <div className="mt-3 rounded-xl border-[1.5px] border-dashed border-line px-3.5 py-12">
              <p className="text-[17px] font-medium">ยังไม่มีรายการเบิก</p>
              <p className="text-sm text-gray-600">แสกนบาร์โค้ดเพื่อเลือก Lot อัตโนมัติ</p>
            </div>
          )}

          <div className="mt-[18px] flex flex-wrap items-center gap-x-7 gap-y-3 rounded-xl bg-[#fafafa] px-4 py-3.5">
            <div>
              <div className="text-xs text-gray-600">รายการ</div>
              <div className="text-2xl font-medium">{cart.length}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">จำนวนรวม</div>
              <div className="text-2xl font-medium">{totalQty}</div>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || cart.length === 0}
              className="ml-auto inline-flex items-center gap-2 rounded-[10px] border border-ink bg-ink px-5 py-3 text-sm font-medium text-white transition hover:bg-black active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}
              ยืนยันการเบิกจ่าย {cart.length} รายการ
            </button>
          </div>
        </section>
      </div>

      {scanMode && (
        <QRScanner
          onScan={handleScan}
          onClose={() => setScanMode(false)}
        />
      )}
    </div>
  );
}
