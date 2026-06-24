'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient, Reagent } from '@/lib/api-client';
import { findMatchingReagent } from '@/lib/barcode-parser';
import QRScanner from '@/components/qr-scanner';
import { 
  ArrowDownToLine,
  ArrowUpFromLine, 
  Camera, 
  Search, 
  Trash2, 
  Loader2, 
  CheckCircle,
  XCircle,
  Building2,
  Calendar
} from 'lucide-react';

interface LendCartItem {
  itemId: string;
  name: string;
  lotNo: string;
  expDate: string;
  qty: number;
  unit: string;
  maxQty?: number; // Used for LEND_OUT
}

export default function LendPage() {
  const [mode, setMode] = useState<'LEND_OUT' | 'RETURN_IN'>('LEND_OUT');
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [patterns, setPatterns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState('');
  const [globalDestination, setGlobalDestination] = useState('');
  const [cart, setCart] = useState<LendCartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    Promise.all([
      apiClient.getDashboard(),
      apiClient.getBarcodePatterns()
    ]).then(([reagentsData, patternsData]) => {
      setReagents(reagentsData);
      setPatterns(patternsData);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    setCart([]);
    setFeedback(null);
  }, [mode]);

  const addToCart = (match: Reagent, barcodeLot: string = '', barcodeExp: string = '') => {
    if (mode === 'LEND_OUT') {
      if (!match.lots || match.lots.length === 0) {
        setFeedback({ type: 'error', msg: `ไม่พบสต๊อกสำหรับ ${match.name} ที่จะให้ยืมได้` });
        return;
      }
      const sortedLots = [...match.lots].sort((a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime());
      let selectedLot = sortedLots[0];

      if (barcodeLot) {
        const exactLot = sortedLots.find(l => l.lotNo.toLowerCase() === barcodeLot.toLowerCase());
        if (exactLot) selectedLot = exactLot;
      }

      const newItem: LendCartItem = {
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
      setFeedback({ type: 'success', msg: `เพิ่มรายการให้ยืม ${match.name} แล้ว` });
    } else {
      const newItem: LendCartItem = {
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
      setFeedback({ type: 'success', msg: `เพิ่มรายการรับคืน ${match.name} แล้ว` });
    }
    
    setSearch('');
    setShowResults(false);
  };

  const handleScan = useCallback((decodedText: string) => {
    const { data, match, lookupValues } = findMatchingReagent(decodedText, patterns, reagents);
    if (!data) return;

    if (match) {
      const parsedLot = data.lot === 'NEED_MANUAL_INPUT' ? '' : data.lot;
      const parsedExp = data.expDate === 'NEED_MANUAL_INPUT' ? '' : data.expDate;
      addToCart(match, parsedLot, parsedExp);
      setScanMode(false);
    } else {
      const parsedId = data.gtin || data.rawString || '-';
      const parsedLot = data.lot === 'NEED_MANUAL_INPUT' ? '-' : data.lot;
      setFeedback({ type: 'error', msg: `ไม่พบข้อมูลใน Master Data | code: ${parsedId} | lot: ${parsedLot} | keys: ${lookupValues.join(', ') || '-'}` });
      setScanMode(false);
    }
  }, [reagents, patterns, mode]);

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (filteredResults.length === 1) {
      addToCart(filteredResults[0]);
    } else {
      handleScan(search);
    }
  };

  const filteredResults = useMemo(() => {
    if (!search.trim()) return [];
    return reagents.filter(r => 
      r.name.toLowerCase().includes(search.toLowerCase()) || 
      r.itemId.toLowerCase().includes(search.toLowerCase()) ||
      (r.qrCode || '').toLowerCase().includes(search.toLowerCase())
    ).slice(0, 5);
  }, [search, reagents]);

  const removeFromCart = (index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };

  const updateQty = (index: number, newQty: string) => {
    const val = parseInt(newQty) || 0;
    setCart(prev => prev.map((item, i) => {
      if (i === index) {
        if (mode === 'LEND_OUT' && item.maxQty) {
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

    if (!globalDestination) {
      setFeedback({ type: 'error', msg: 'กรุณาระบุหน่วยงาน (โรงพยาบาล/แผนก)' });
      return;
    }
    
    setSubmitting(true);
    try {
      if (mode === 'LEND_OUT') {
        const payload = validItems.map(i => ({ ...i, note: `ให้ยืมไปที่: ${globalDestination}` }));
        await apiClient.dispenseBatch(payload);
        setFeedback({ type: 'success', msg: 'บันทึกรายการให้ยืมสำเร็จ (ตัดสต๊อก)' });
      } else {
        const payload = validItems.map(i => ({ ...i, note: `รับคืนจาก: ${globalDestination}` }));
        await apiClient.receiveBatch(payload);
        setFeedback({ type: 'success', msg: 'บันทึกรายการรับคืนเข้าคลังสำเร็จ (สต๊อกเพิ่ม)' });
      }
      setCart([]);
      setGlobalDestination('');
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
        <Loader2 className="animate-spin text-purple-600" size={48} />
        <p className="text-gray-500 animate-pulse font-bold text-xs">กำลังเตรียมระบบให้ยืมน้ำยา...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto pb-24">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center">
            <ArrowUpFromLine size={28} />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">ระบบให้ยืม (Lend)</h1>
        </div>
        <p className="text-gray-500 text-sm font-bold">จัดการน้ำยาที่เราให้หน่วยงานอื่นยืมไป</p>
      </div>

      <div className="bg-gray-100 p-1.5 rounded-2xl flex relative shadow-inner">
        <button 
          onClick={() => setMode('LEND_OUT')}
          className={`flex-1 py-3 px-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all z-10 ${mode === 'LEND_OUT' ? 'bg-white text-purple-600 shadow' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <ArrowUpFromLine size={18} /> ให้เขายืม (ตัดออก)
        </button>
        <button 
          onClick={() => setMode('RETURN_IN')}
          className={`flex-1 py-3 px-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all z-10 ${mode === 'RETURN_IN' ? 'bg-white text-teal-600 shadow' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <ArrowDownToLine size={18} /> รับคืนมา (รับเข้า)
        </button>
      </div>

      {feedback && (
        <div className={`p-4 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 ${
          feedback.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={20} /> : <XCircle size={20} />}
          <p className="text-sm font-black flex-1">{feedback.msg}</p>
          <button onClick={() => setFeedback(null)} className="text-[10px] font-black uppercase">Close</button>
        </div>
      )}

      <div className={`bg-white p-6 rounded-3xl border-2 shadow-sm space-y-4 transition-colors ${mode === 'LEND_OUT' ? 'border-purple-100' : 'border-teal-100'}`}>
        <label className={`block text-[10px] font-black uppercase tracking-widest ${mode === 'LEND_OUT' ? 'text-purple-600' : 'text-teal-600'}`}>
          {mode === 'LEND_OUT' ? 'ให้หน่วยงานไหนยืม?' : 'รับคืนจากหน่วยงานไหน?'}
        </label>
        <div className="relative">
          <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text"
            value={globalDestination}
            onChange={(e) => setGlobalDestination(e.target.value)}
            placeholder="ระบุชื่อแผนก หรือ โรงพยาบาล..."
            className="w-full pl-11 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
        <button 
          onClick={() => setScanMode(true)}
          className={`w-full text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg ${mode === 'LEND_OUT' ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200' : 'bg-teal-600 hover:bg-teal-700 shadow-teal-200'}`}
        >
          <Camera size={20} />
          เปิดกล้องแสกนบาร์โค้ด
        </button>

        <form onSubmit={handleManualAdd} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              placeholder="ค้นหาด่วน หรือ พิมพ์รหัส..."
              className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-purple-500"
            />
            {showResults && filteredResults.length > 0 && (
              <div className="absolute z-10 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {filteredResults.map(item => (
                  <button
                    key={item.itemId}
                    type="button"
                    onClick={() => addToCart(item)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 flex flex-col border-b border-gray-50 last:border-none"
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-bold text-gray-900">{item.name}</span>
                      {mode === 'LEND_OUT' && <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">มีให้ยืม: {item.quantity}</span>}
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase">ID: {item.itemId}</span>
                  </button>
                ))}
              </div>
            )}
            {showResults && <div className="fixed inset-0 z-0" onClick={() => setShowResults(false)} />}
          </div>
          <button type="submit" className={`px-6 rounded-xl font-black text-sm transition-colors relative z-10 ${mode === 'LEND_OUT' ? 'bg-purple-50 text-purple-600 hover:bg-purple-100' : 'bg-teal-50 text-teal-600 hover:bg-teal-100'}`}>
            เพิ่ม
          </button>
        </form>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="font-black text-gray-800 flex items-center gap-2">
            ตะกร้าการ{mode === 'LEND_OUT' ? 'ให้ยืม' : 'รับคืน'}
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${mode === 'LEND_OUT' ? 'bg-purple-100 text-purple-600' : 'bg-teal-100 text-teal-600'}`}>{cart.length}</span>
          </h2>
        </div>

        {cart.length === 0 ? (
          <div className="bg-gray-50/50 border-2 border-dashed border-gray-200 rounded-3xl p-12 text-center">
            {mode === 'LEND_OUT' ? <ArrowUpFromLine className="mx-auto text-gray-300 mb-4" size={48} /> : <ArrowDownToLine className="mx-auto text-gray-300 mb-4" size={48} />}
            <p className="text-gray-400 text-sm font-bold">ยังไม่มีรายการ<br/>เริ่มแสกนน้ำยาที่ต้องการบันทึก</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map((item, index) => (
              <div key={`${item.itemId}-${item.lotNo}-${index}`} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 truncate text-sm">{item.name}</h3>
                  
                  {mode === 'RETURN_IN' ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-2 mt-2 text-[11px] font-medium text-gray-500">
                      <span className="bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded flex items-center">ID: {item.itemId}</span>
                      <div className="flex items-center gap-1">
                        <span className="bg-gray-50 px-1.5 py-0.5 rounded font-mono">Lot:</span>
                        <input 
                          type="text" 
                          value={item.lotNo} 
                          onChange={e => updateLotNo(index, e.target.value)}
                          placeholder="ระบุ Lot"
                          className="border border-gray-200 rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-teal-500 w-24"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="bg-gray-50 px-1.5 py-0.5 rounded">EXP:</span>
                        <input 
                          type="date" 
                          value={item.expDate} 
                          onChange={e => updateExpDate(index, e.target.value)}
                          className="border border-gray-200 rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 mt-1">
                      <span className="bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded text-[10px] font-black">Lot: {item.lotNo || '-'}</span>
                      <span className="bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded text-[10px] font-black flex items-center gap-1">
                        <Calendar size={10} />
                        {new Date(item.expDate).toLocaleDateString('th-TH')}
                      </span>
                      {item.maxQty !== undefined && <span className="text-[10px] text-gray-400 mt-1 uppercase w-full">ให้ยืมได้สูงสุดจาก Lot นี้: {item.maxQty} {item.unit}</span>}
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-3">
                  <input 
                    type="number"
                    value={item.qty}
                    onChange={(e) => updateQty(index, e.target.value)}
                    className="w-14 text-center font-black bg-gray-50 border border-gray-200 rounded-lg py-2 text-gray-900 text-lg outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button 
                    onClick={() => removeFromCart(index)}
                    className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}

            <div className="pt-4 px-2">
              <button 
                onClick={handleSubmit}
                disabled={submitting}
                className={`w-full text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg disabled:opacity-50 ${mode === 'RETURN_IN' ? 'bg-green-600 hover:bg-green-700 shadow-green-200' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-200'}`}
              >
                {submitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
                ยืนยันการบันทึก {cart.length} รายการ
              </button>
            </div>
          </div>
        )}
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
