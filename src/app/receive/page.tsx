'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiClient, BarcodePattern, Reagent } from '@/lib/api-client';
import { findMatchingReagentWithV2 } from '@/lib/barcode-parser';
import QRScanner from '@/components/lazy-qr-scanner';
import { ErrorNotice } from '@/components/error-notice';
import { parseApiError, type ApiErrorInfo } from '@/lib/api-errors-client';
import Modal from '@/components/modal';
import {
  Camera,
  Trash2,
  Loader2,
  CheckCircle,
  X,
} from 'lucide-react';

interface CartItem {
  cartId: string;
  itemId: string;
  name: string;
  lotNo: string;
  expDate: string;
  qty: number;
  unit: string;
}

export default function ReceivePage() {
  const { user, loading: authLoading } = useAuth();
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [v2Patterns, setV2Patterns] = useState<import('@/lib/api-client').BarcodePatternV2Runtime[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiErrorInfo | null>(null);
  const [submitError, setSubmitError] = useState<ApiErrorInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('ALL');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [inactiveScan, setInactiveScan] = useState<{ reagent: Reagent; lot: string; exp: string } | null>(null);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<ApiErrorInfo | null>(null);
  const canActivate = user?.role === 'Admin' || user?.role === 'Manager';
  const cartIdRef = useRef(0);

  const createCartId = (itemId: string) => {
    cartIdRef.current += 1;
    return `${itemId}-${cartIdRef.current}`;
  };

  const loadLookupData = async () => {
    setLoading(true);
    setLoadError(null);
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
      setLoadError(parseApiError(err, 'โหลดข้อมูลสำหรับค้นหาไม่สำเร็จ'));
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
        setLoadError(parseApiError(err, 'โหลดข้อมูลสำหรับค้นหาไม่สำเร็จ'));
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

  const addToCart = (match: Reagent, lot: string = '', exp: string = '') => {
    // A deactivated reagent cannot be received; ask first so Admin/Manager can turn it back on.
    if (match.isActive === false) {
      setActivateError(null);
      setInactiveScan({ reagent: match, lot, exp });
      setSearch('');
      setShowResults(false);
      return;
    }

    const newItem: CartItem = {
      cartId: createCartId(match.itemId),
      itemId: match.itemId,
      name: match.name,
      lotNo: lot,
      expDate: exp,
      qty: 1,
      unit: match.unit
    };

    setCart(prev => {
      const existing = prev.find(i => i.itemId === newItem.itemId && i.lotNo === newItem.lotNo);
      if (existing) {
        return prev.map(i => i === existing ? { ...i, qty: i.qty + 1 } : i);
      }
      return [newItem, ...prev];
    });

    setSearch('');
    setShowResults(false);
    setFeedback({ type: 'success', msg: `เพิ่ม ${match.name} ลงตะกร้าแล้ว` });
  };

  const handleActivateScanned = async () => {
    if (!inactiveScan) return;
    setActivating(true);
    setActivateError(null);
    try {
      await apiClient.updateReagentStatus(inactiveScan.reagent.itemId, true, 'เปิดใช้งานจากหน้ารับเข้า (สแกนพบน้ำยาที่ปิดใช้งาน)');
      const activated: Reagent = { ...inactiveScan.reagent, isActive: true, statusReason: null };
      setReagents(prev => prev.map(r => r.itemId === activated.itemId ? activated : r));
      setInactiveScan(null);
      addToCart(activated, inactiveScan.lot, inactiveScan.exp);
      setFeedback({ type: 'success', msg: `เปิดใช้งาน ${activated.name} แล้ว และเพิ่มลงตะกร้า` });
    } catch (err: unknown) {
      setActivateError(parseApiError(err, 'เปิดใช้งานน้ำยาไม่สำเร็จ'));
    } finally {
      setActivating(false);
    }
  };

  const handleScan = (decodedText: string) => {
    const { data, match, lookupValues } = findMatchingReagentWithV2(decodedText, patterns, v2Patterns, reagents, v2Patterns.length > 0);
    if (!data) {
      setFeedback({ type: 'error', msg: 'ไม่สามารถอ่าน QR/Barcode นี้ได้ กรุณาลองใหม่' });
      setScanMode(false);
      return;
    }

    if (match) {
      addToCart(match, data.lot === 'NEED_MANUAL_INPUT' ? '' : data.lot, data.expDate === 'NEED_MANUAL_INPUT' ? '' : data.expDate);
      setScanMode(false);
    } else {
      const parsedId = data.gtin || data.rawString || '-';
      const parsedLot = data.lot === 'NEED_MANUAL_INPUT' ? '-' : data.lot;
      setFeedback({ type: 'error', msg: `ไม่พบข้อมูลใน Master Data | code: ${parsedId} | lot: ${parsedLot} | keys: ${lookupValues.join(', ') || '-'}` });
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
    setCart(prev => prev.map(item => item.cartId === cartId ? { ...item, qty: val } : item));
  };

  const updateLotNo = (cartId: string, newLot: string) => {
    setCart(prev => prev.map(item => item.cartId === cartId ? { ...item, lotNo: newLot } : item));
  };

  const updateExpDate = (cartId: string, newExp: string) => {
    setCart(prev => prev.map(item => item.cartId === cartId ? { ...item, expDate: newExp } : item));
  };

  const handleSubmit = async () => {
    // Filter out items with 0 or negative quantity
    const validItems = cart.filter(item => item.qty > 0);
    
    if (validItems.length === 0) {
      setFeedback({ type: 'error', msg: 'กรุณาระบุจำนวนที่ต้องการรับเข้า (ต้องมากกว่า 0)' });
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiClient.receiveBatch(validItems);
      setFeedback({ type: 'success', msg: 'บันทึกรายการรับน้ำยาเข้าคลังเรียบร้อยแล้ว' });
      setCart([]);
      await loadLookupData();
      } catch (err: unknown) {
      setFeedback(null);
      setSubmitError(parseApiError(err, 'บันทึกรายการไม่สำเร็จ'));
      } finally {
      setSubmitting(false);
      }
  };

  if (authLoading || (user && loading)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-blue-600" size={48} />
        <p className="text-gray-500 animate-pulse">กำลังโหลดข้อมูลฐานน้ำยา...</p>
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-[32px] leading-tight font-medium text-ink">รับเข้าคลังหลัก</h1>
        <p className="mt-1.5 text-[15px] text-gray-600">แสกนบาร์โค้ด GS1 หรือพิมพ์รหัสเพื่อเพิ่มลงตะกร้า</p>
      </div>

      <ErrorNotice error={loadError} onRetry={() => void loadLookupData()} />

      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Action Area */}
        <section aria-labelledby="receive-scan-heading" className="flex min-w-0 flex-col gap-3.5 rounded-2xl border border-line bg-white p-5">
          <h2 id="receive-scan-heading" className="text-lg font-medium">สแกน / ค้นหา</h2>
          <button
            type="button"
            onClick={() => setScanMode(true)}
            className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-ink bg-ink px-[18px] py-4 text-base font-medium text-white transition hover:bg-black active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-800"
          >
            <Camera size={20} />
            เปิดกล้องแสกน Barcode
          </button>

          <div className="flex items-center gap-2.5 text-xs text-gray-600">
            <span className="h-px flex-1 bg-line" />
            หรือพิมพ์รหัส
            <span className="h-px flex-1 bg-line" />
          </div>

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
                        <span className="block text-xs text-gray-600">ID: {item.itemId}</span>
                      </span>
                      <span className="text-[13px] text-blue-700">+ เพิ่ม</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Click away listener for mobile/desktop */}
              {showResults && (
                <div
                  className="fixed inset-0 z-0"
                  onClick={() => setShowResults(false)}
                />
              )}
            </div>
            <button type="submit" className="relative z-10 inline-flex items-center rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink transition hover:bg-gray-50">
              เพิ่ม
            </button>
          </form>

          {/* Feedback */}
          {feedback && (
            <div role="status" className={`flex items-start gap-3 rounded-xl px-3.5 py-3 text-sm font-medium ${feedback.type === 'success' ? 'bg-ok-bg text-ok' : 'bg-crit-bg text-crit'}`}>
              <span className="flex-1">{feedback.msg}</span>
              <button type="button" onClick={() => setFeedback(null)} aria-label="ปิดข้อความ" className="opacity-70 hover:opacity-100"><X size={16} /></button>
            </div>
          )}
          <ErrorNotice error={submitError} onDismiss={() => setSubmitError(null)} />
        </section>

        {/* Cart Area */}
        <section aria-labelledby="receive-cart-heading" className="min-w-0 rounded-2xl border border-line bg-white p-5">
          <div className="mb-3 flex items-center">
            <h2 id="receive-cart-heading" className="mr-auto text-lg font-medium">
              รายการในตะกร้า
              <span className="ml-1 inline-flex items-center rounded-full bg-gray-200 px-2.5 py-[3px] text-xs font-medium">{cart.length}</span>
            </h2>
            {cart.length > 0 && (
              <button type="button" onClick={() => setCart([])} className="rounded-[10px] px-2.5 py-1.5 text-sm font-medium text-crit hover:bg-crit-bg">ล้างตะกร้า</button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
              <caption className="sr-only">รายการรับเข้าในตะกร้า</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${headClass} rounded-l-[10px]`}>รายการ</th>
                  <th scope="col" className={`${headClass} w-[150px]`}>Lot</th>
                  <th scope="col" className={`${headClass} w-[160px]`}>EXP</th>
                  <th scope="col" className={`${headClass} w-[90px]`}>จำนวน</th>
                  <th scope="col" className={`${headClass} w-11 rounded-r-[10px]`}><span className="sr-only">ลบ</span></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item) => (
                  <tr key={item.cartId}>
                    <td className={cellClass}>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-gray-600">ID: {item.itemId}</div>
                    </td>
                    <td className={cellClass}>
                      <input
                        type="text"
                        value={item.lotNo}
                        onChange={e => updateLotNo(item.cartId, e.target.value)}
                        placeholder="ระบุ Lot"
                        aria-label={`Lot ของ ${item.name}`}
                        className={fieldClass}
                      />
                    </td>
                    <td className={cellClass}>
                      <input
                        type="date"
                        value={item.expDate}
                        onChange={e => updateExpDate(item.cartId, e.target.value)}
                        aria-label={`วันหมดอายุของ ${item.name}`}
                        className={fieldClass}
                      />
                    </td>
                    <td className={cellClass}>
                      <input
                        type="number"
                        min="0"
                        value={item.qty}
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
              <p className="text-[17px] font-medium">ยังไม่มีรายการในตะกร้า</p>
              <p className="text-sm text-gray-600">เริ่มแสกนเพื่อทำรายการรับเข้า</p>
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
              ยืนยันการรับเข้า {cart.length} รายการ
            </button>
          </div>
        </section>
      </div>

      <Modal isOpen={Boolean(inactiveScan)} onClose={() => !activating && setInactiveScan(null)} title="น้ำยานี้ถูกปิดใช้งาน">
        {inactiveScan && (
          <div className="space-y-4">
            <div className="rounded-xl bg-warn-bg px-3.5 py-3 text-sm text-warn">
              <p className="font-medium">{inactiveScan.reagent.name} ({inactiveScan.reagent.itemId})</p>
              <p className="mt-1">เหตุผลที่ปิด: {inactiveScan.reagent.statusReason || '-'}</p>
            </div>
            <p className="text-sm text-gray-600">
              {canActivate
                ? 'ต้องเปิดใช้งานน้ำยานี้ก่อนจึงจะรับเข้าคลังได้ ต้องการเปิดใช้งานและเพิ่มลงตะกร้าหรือไม่?'
                : 'ไม่สามารถรับเข้าน้ำยาที่ปิดใช้งานได้ กรุณาติดต่อ Admin หรือ Manager เพื่อเปิดใช้งานก่อน'}
            </p>
            <ErrorNotice error={activateError} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setInactiveScan(null)} disabled={activating} className="rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-50">
                {canActivate ? 'ยกเลิก' : 'ปิด'}
              </button>
              {canActivate && (
                <button type="button" onClick={handleActivateScanned} disabled={activating} className="inline-flex items-center gap-2 rounded-[10px] bg-ink px-4 py-[9px] text-sm font-medium text-white hover:bg-black disabled:opacity-50">
                  {activating && <Loader2 className="animate-spin" size={16} />}
                  เปิดใช้งานและเพิ่มลงตะกร้า
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Scanner Modal */}
      {scanMode && (
        <QRScanner
          onScan={handleScan}
          onClose={() => setScanMode(false)}
        />
      )}
    </div>
  );
}
