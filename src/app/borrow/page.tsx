'use client';

import { useEffect, useState } from 'react';
import { apiClient, BarcodePattern, Reagent } from '@/lib/api-client';
import { findMatchingReagentWithV2, processAnyBarcode } from '@/lib/barcode-parser';
import QRScanner from '@/components/lazy-qr-scanner';
import OutstandingLoans, { OutstandingLoan } from '@/components/outstanding-loans';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Camera,
  Trash2,
  Loader2,
  CheckCircle,
  X,
} from 'lucide-react';

interface BorrowCartItem {
  itemId: string;
  name: string;
  lotNo: string;
  expDate: string;
  qty: number;
  unit: string;
  maxQty?: number; // Used for RETURN_OUT
  loanId?: number;
}

export default function BorrowPage() {
  const [mode, setMode] = useState<'BORROW_IN' | 'RETURN_OUT'>('BORROW_IN');
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [v2Patterns, setV2Patterns] = useState<import('@/lib/api-client').BarcodePatternV2Runtime[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState('');
  const [globalOrigin, setGlobalOrigin] = useState('');
  const [cart, setCart] = useState<BorrowCartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [outstandingLoans, setOutstandingLoans] = useState<OutstandingLoan[]>([]);
  const [outstandingLoading, setOutstandingLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiClient.getDashboard(),
      apiClient.getBarcodeRuntimePatterns(),
      apiClient.getOutstandingLoans('BORROWED_IN')
    ]).then(([reagentsData, runtimeData, loansData]) => {
      setReagents(reagentsData);
      setPatterns(runtimeData.patterns);
      setV2Patterns(runtimeData.v2Patterns);
      setOutstandingLoans(loansData);
      setLoading(false);
      setOutstandingLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
      setOutstandingLoading(false);
    });
  }, []);

  const selectOutstandingLoan = (loan: OutstandingLoan) => {
    setMode('RETURN_OUT');
    setGlobalOrigin(loan.partner_name);
    setCart([{
      loanId: loan.id,
      itemId: loan.item_id,
      name: loan.item_name,
      lotNo: loan.lot_no,
      expDate: loan.exp_date?.slice(0, 10) || '',
      qty: Number(loan.remaining_qty),
      maxQty: Number(loan.remaining_qty),
      unit: reagents.find((item) => item.itemId === loan.item_id)?.unit || 'unit'
    }]);
    setFeedback({ type: 'success', msg: `เลือกรายการค้างของ ${loan.partner_name} เพื่อส่งคืนแล้ว` });
  };

  const addToCart = (match: Reagent, barcodeLot: string = '', barcodeExp: string = '') => {
    if (mode === 'RETURN_OUT') {
      // FEFO Logic (Like Dispense)
      if (!match.lots || match.lots.length === 0) {
        setFeedback({ type: 'error', msg: `ไม่พบสต๊อกสำหรับ ${match.name} ที่จะส่งคืนได้` });
        return;
      }
      const sortedLots = [...match.lots].sort((a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime());
      let selectedLot = sortedLots[0];

      if (barcodeLot) {
        const exactLot = sortedLots.find(l => l.lotNo.toLowerCase() === barcodeLot.toLowerCase());
        if (exactLot) selectedLot = exactLot;
      }

      const newItem: BorrowCartItem = {
        itemId: match.itemId,
        name: match.name,
        lotNo: selectedLot.lotNo,
        expDate: selectedLot.expDate,
        qty: 1,
        unit: match.unit,
        maxQty: selectedLot.qty
      };

      setCart(prev => {
        const existing = prev.find(i => i.itemId === newItem.itemId && i.lotNo === newItem.lotNo);
        if (existing) {
          const updatedQty = Math.min(existing.qty + 1, existing.maxQty || Infinity);
          return prev.map(i => i === existing ? { ...i, qty: updatedQty } : i);
        }
        return [newItem, ...prev];
      });
      setFeedback({ type: 'success', msg: `เพิ่มรายการส่งคืน ${match.name} แล้ว` });
    } else {
      // BORROW_IN Logic (Like Receive)
      const newItem: BorrowCartItem = {
        itemId: match.itemId,
        name: match.name,
        lotNo: barcodeLot,
        expDate: barcodeExp,
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
      setFeedback({ type: 'success', msg: `เพิ่มรายการยืมเข้า ${match.name} แล้ว` });
    }
    
    setSearch('');
    setShowResults(false);
  };

  const handleScan = (decodedText: string) => {
    let data = processAnyBarcode(decodedText, patterns);
    if (!data) return;

    const cleanGtin = data.gtin.replace(/^0+/, '');
    const cleanRaw = data.rawString.replace(/^0+/, '');

    let match = reagents.find(r => {
      const dbBarcode = r.qrCode?.replace(/^0+/, '') || '';
      const dbItemId = r.itemId.replace(/^0+/, '');

      return (
        dbItemId.toLowerCase() === cleanGtin.toLowerCase() ||
        dbBarcode.toLowerCase() === cleanGtin.toLowerCase() ||
        dbItemId.toLowerCase() === cleanRaw.toLowerCase()
      );
    });

    // Preserve the legacy direct match above; V2 is only a fallback.
    if (!match && v2Patterns.length > 0) {
      const v2Result = findMatchingReagentWithV2(decodedText, [], v2Patterns, reagents, true);
      if (v2Result.match && v2Result.data) {
        match = v2Result.match;
        data = v2Result.data;
      }
    }

    if (match) {
      const parsedLot = data.lot === 'NEED_MANUAL_INPUT' ? '' : data.lot;
      const parsedExp = data.expDate === 'NEED_MANUAL_INPUT' ? '' : data.expDate;
      addToCart(match, parsedLot, parsedExp);
      setScanMode(false);
    } else {
      setFeedback({ type: 'error', msg: 'ไม่พบข้อมูลน้ำยานี้ในระบบ Master Data' });
      setScanMode(false);
    }
  };

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (filteredResults.length === 1) {
      addToCart(filteredResults[0]);
    } else {
      handleScan(search);
    }
  };

  const filteredResults = !search.trim()
    ? []
    : reagents.filter(r =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.itemId.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 5);

  const removeFromCart = (index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };

  const updateQty = (index: number, newQty: string) => {
    const val = parseInt(newQty) || 0;
    setCart(prev => prev.map((item, i) => {
      if (i === index) {
        if (mode === 'RETURN_OUT' && item.maxQty) {
          return { ...item, qty: Math.min(val, item.maxQty) };
        }
        return { ...item, qty: val };
      }
      return item;
    }));
  };

  const updateLotNo = (index: number, newLot: string) => {
    setCart(prev => prev.map((item, i) => i === index ? { ...item, lotNo: newLot } : item));
  };

  const updateExpDate = (index: number, newExp: string) => {
    setCart(prev => prev.map((item, i) => i === index ? { ...item, expDate: newExp } : item));
  };

  const handleSubmit = async () => {
    const validItems = cart.filter(item => item.qty > 0);
    if (validItems.length === 0) return;

    if (!globalOrigin) {
      setFeedback({ type: 'error', msg: 'กรุณาระบุหน่วยงาน (โรงพยาบาล/แผนก)' });
      return;
    }
    
    setSubmitting(true);
    try {
      if (mode === 'BORROW_IN') {
        const payload = validItems.map(i => ({ ...i, note: `ยืมมาจาก: ${globalOrigin}` }));
        await apiClient.recordLoanBatch(mode, globalOrigin, payload);
        setFeedback({ type: 'success', msg: 'บันทึกรายการยืมเข้าคลังสำเร็จ (สต๊อกเพิ่ม)' });
      } else {
        const payload = validItems.map(i => ({ ...i, note: `ส่งคืนให้: ${globalOrigin}` }));
        await apiClient.recordLoanBatch(mode, globalOrigin, payload);
        setFeedback({ type: 'success', msg: 'บันทึกรายการส่งคืนสำเร็จ (ตัดสต๊อก)' });
      }
      setCart([]);
      setGlobalOrigin('');
      setOutstandingLoans(await apiClient.getOutstandingLoans('BORROWED_IN'));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }, message: string };
      setFeedback({ type: 'error', msg: 'เกิดข้อผิดพลาด: ' + (error.response?.data?.error || error.message) });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-blue-600" size={48} />
        <p className="text-gray-500 animate-pulse font-bold text-xs">กำลังเตรียมระบบยืม/คืนน้ำยา...</p>
      </div>
    );
  }

  const borrowIn = mode === 'BORROW_IN';
  const totalQty = cart.reduce((sum, item) => sum + (item.qty > 0 ? item.qty : 0), 0);
  const fieldClass = 'min-h-[38px] w-full rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10';
  const cellClass = 'border-b border-line px-3.5 py-3 align-middle text-sm';
  const headClass = 'bg-ground px-3.5 py-2.5 text-left text-[13px] font-medium text-gray-600';
  const tabClass = (active: boolean) => `inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-medium transition ${active ? 'bg-ink text-white' : 'text-gray-700 hover:bg-gray-100'}`;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-[32px] leading-tight font-medium text-ink">ระบบยืม (Borrow)</h1>
        <p className="mt-1.5 text-[15px] text-gray-600">ยืมน้ำยาจากหน่วยงานอื่นเข้าคลัง และบันทึกการส่งคืน</p>
      </div>

      {feedback && (
        <div role="status" className={`flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium ${feedback.type === 'success' ? 'bg-ok-bg text-ok' : 'bg-crit-bg text-crit'}`}>
          <span className="flex-1">{feedback.msg}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="ปิดข้อความ" className="opacity-70 hover:opacity-100"><X size={16} /></button>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        {/* Form card */}
        <section aria-labelledby="borrow-form-heading" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-white p-5">
          <h2 id="borrow-form-heading" className="text-lg font-medium">{borrowIn ? 'บันทึกยืมเข้า' : 'บันทึกการส่งคืน'}</h2>

          <div role="group" aria-label="เลือกประเภทรายการ" className="flex gap-1 rounded-xl bg-ground p-1">
            <button type="button" aria-pressed={borrowIn} onClick={() => { setMode('BORROW_IN'); setCart([]); setFeedback(null); }} className={tabClass(borrowIn)}>
              <ArrowDownToLine size={16} /> ยืมเข้ามา
            </button>
            <button type="button" aria-pressed={!borrowIn} onClick={() => { setMode('RETURN_OUT'); setCart([]); setFeedback(null); }} className={tabClass(!borrowIn)}>
              <ArrowUpFromLine size={16} /> ส่งคืนไป
            </button>
          </div>

          <label className="flex flex-col gap-1.5 text-[13px] text-gray-600">
            {borrowIn ? 'ยืมจากหน่วยงาน' : 'ส่งคืนให้หน่วยงาน'}
            <input
              type="text"
              value={globalOrigin}
              onChange={(e) => setGlobalOrigin(e.target.value)}
              placeholder="เช่น รพ.ชุมชนพยุหะคีรี"
              className={fieldClass}
            />
          </label>

          <button
            type="button"
            onClick={() => setScanMode(true)}
            className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-ink bg-ink px-[18px] py-3.5 text-base font-medium text-white transition hover:bg-black active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-800"
          >
            <Camera size={20} />
            เปิดกล้องแสกน Barcode
          </button>

          <div className="flex items-center gap-2.5 text-xs text-gray-600">
            <span className="h-px flex-1 bg-line" />
            หรือพิมพ์รหัส
            <span className="h-px flex-1 bg-line" />
          </div>

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
                      {!borrowIn && <span className="text-xs text-gray-600">คงเหลือ {item.quantity}</span>}
                      <span className="text-[13px] text-blue-700">+ เพิ่ม</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Click away listener */}
              {showResults && <div className="fixed inset-0 z-0" onClick={() => setShowResults(false)} />}
            </div>
            <button type="submit" className="relative z-10 inline-flex items-center rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink transition hover:bg-gray-50">
              เพิ่ม
            </button>
          </form>

          <p className="text-xs text-gray-600">
            {borrowIn ? 'ระบบจะเพิ่มยอดเข้าคลังเป็น lot ที่ยืมมา' : 'ระบบจะตัดยอดออกจาก lot ที่เลือกเมื่อส่งคืน'}
          </p>
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          {/* Outstanding loans */}
          <section aria-labelledby="borrow-open-heading" className="min-w-0 rounded-2xl border border-line bg-white p-5">
            <h2 id="borrow-open-heading" className="text-lg font-medium">รายการยืมเข้าที่ยังค้างส่งคืน</h2>
            <p className="mb-3 text-[13px] text-gray-600">เลือกหนึ่งรายการเพื่อบันทึกการส่งคืน</p>
            <OutstandingLoans loans={outstandingLoans} loading={outstandingLoading} onSelect={selectOutstandingLoan} />
          </section>

          {/* Cart Area */}
          <section aria-labelledby="borrow-cart-heading" className="min-w-0 rounded-2xl border border-line bg-white p-5">
            <div className="mb-3 flex items-center">
              <h2 id="borrow-cart-heading" className="mr-auto text-lg font-medium">
                รายการ{borrowIn ? 'ยืมเข้า' : 'ส่งคืน'}ในตะกร้า
                <span className="ml-1 inline-flex items-center rounded-full bg-gray-200 px-2.5 py-[3px] text-xs font-medium">{cart.length}</span>
              </h2>
              {cart.length > 0 && (
                <button type="button" onClick={() => setCart([])} className="rounded-[10px] px-2.5 py-1.5 text-sm font-medium text-crit hover:bg-crit-bg">ล้างตะกร้า</button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
                <caption className="sr-only">รายการ{borrowIn ? 'ยืมเข้า' : 'ส่งคืน'}ในตะกร้า</caption>
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
                  {cart.map((item, index) => (
                    <tr key={`${item.itemId}-${item.lotNo}-${index}`}>
                      <td className={cellClass}>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-gray-600">ID: {item.itemId}</div>
                      </td>
                      {borrowIn ? (
                        <>
                          <td className={cellClass}>
                            <input
                              type="text"
                              value={item.lotNo}
                              onChange={e => updateLotNo(index, e.target.value)}
                              placeholder="ระบุ Lot"
                              aria-label={`Lot ของ ${item.name}`}
                              className={fieldClass}
                            />
                          </td>
                          <td className={cellClass}>
                            <input
                              type="date"
                              value={item.expDate}
                              onChange={e => updateExpDate(index, e.target.value)}
                              aria-label={`วันหมดอายุของ ${item.name}`}
                              className={fieldClass}
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={cellClass}>{item.lotNo || '-'}</td>
                          <td className={cellClass}>{item.expDate ? new Date(item.expDate).toLocaleDateString('th-TH') : '-'}</td>
                        </>
                      )}
                      <td className={cellClass}>
                        <input
                          type="number"
                          min="0"
                          value={item.qty}
                          onChange={(e) => updateQty(index, e.target.value)}
                          aria-label={`จำนวน (${item.unit}) ของ ${item.name}`}
                          className={`${fieldClass} font-semibold`}
                        />
                        <div className="text-[11px] text-gray-600">
                          {item.unit}{!borrowIn && item.maxQty !== undefined ? ` · สูงสุด ${item.maxQty}` : ''}
                        </div>
                      </td>
                      <td className={cellClass}>
                        <button
                          type="button"
                          onClick={() => removeFromCart(index)}
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
                <p className="text-sm text-gray-600">เริ่มแสกนน้ำยาที่ต้องการบันทึก</p>
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
                {borrowIn ? 'ยืนยันการยืมเข้า' : 'ยืนยันการส่งคืน'} {cart.length} รายการ
              </button>
            </div>
          </section>
        </div>
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
