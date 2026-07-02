'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiClient, BarcodePattern, Reagent } from '@/lib/api-client';
import { findMatchingReagent } from '@/lib/barcode-parser';
import QRScanner from '@/components/qr-scanner';
import { 
  PackagePlus, 
  Camera, 
  Search, 
  Trash2, 
  Loader2, 
  CheckCircle,
  XCircle,
  AlertCircle
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const cartIdRef = useRef(0);

  const createCartId = (itemId: string) => {
    cartIdRef.current += 1;
    return `${itemId}-${cartIdRef.current}`;
  };

  const loadLookupData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [reagentsData, patternsData] = await Promise.all([
        apiClient.getDashboard(),
        apiClient.getBarcodePatterns()
      ]);
      setReagents(reagentsData);
      setPatterns(patternsData);
    } catch (err: unknown) {
      console.error(err);
      const error = err as { response?: { data?: { error?: string } }, message?: string };
      setLoadError(error.response?.data?.error || error.message || 'Unable to load lookup data');
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
        const [reagentsData, patternsData] = await Promise.all([
          apiClient.getDashboard(),
          apiClient.getBarcodePatterns()
        ]);

        if (!active) {
          return;
        }

        setReagents(reagentsData);
        setPatterns(patternsData);
      } catch (err: unknown) {
        if (!active) {
          return;
        }

        console.error(err);
        const error = err as { response?: { data?: { error?: string } }, message?: string };
        setLoadError(error.response?.data?.error || error.message || 'Unable to load lookup data');
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

  const handleScan = (decodedText: string) => {
    const { data, match, lookupValues } = findMatchingReagent(decodedText, patterns, reagents);
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
      r.name.toLowerCase().includes(search.toLowerCase()) || 
      r.itemId.toLowerCase().includes(search.toLowerCase()) ||
      (r.qrCode || '').toLowerCase().includes(search.toLowerCase())
    ).slice(0, 5);
  }, [search, reagents]);

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
    try {
      await apiClient.receiveBatch(validItems);
      setFeedback({ type: 'success', msg: 'บันทึกรายการรับน้ำยาเข้าคลังเรียบร้อยแล้ว' });
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
        <Loader2 className="animate-spin text-blue-600" size={48} />
        <p className="text-gray-500 animate-pulse">กำลังโหลดข้อมูลฐานน้ำยา...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center">
            <PackagePlus size={28} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">รับเข้าคลังหลัก</h1>
        </div>
        <p className="text-gray-500 text-sm">แสกนบาร์โค้ด GS1 หรือพิมพ์รหัสเพื่อเพิ่มลงตะกร้า</p>
      </div>

      {/* Feedback Toast-like */}
      {feedback && (
        <div className={`p-4 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 ${
          feedback.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={20} /> : <XCircle size={20} />}
          <p className="text-sm font-bold flex-1">{feedback.msg}</p>
          <button onClick={() => setFeedback(null)}><AlertCircle size={16} className="opacity-50" /></button>
        </div>
      )}

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-100 text-sm font-bold">
          โหลดข้อมูลไม่สำเร็จ: {loadError}
        </div>
      )}

      {/* Action Area */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
        <button 
          onClick={() => setScanMode(true)}
          className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-800 transition-all active:scale-[0.98] shadow-lg shadow-gray-200"
        >
          <Camera size={20} />
          เปิดกล้องแสกน Barcode
        </button>

        <div className="relative flex items-center">
          <div className="flex-1 border-t border-gray-100"></div>
          <span className="px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">หรือพิมพ์รหัส</span>
          <div className="flex-1 border-t border-gray-100"></div>
        </div>

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
              placeholder="รหัสน้ำยา หรือ บาร์โค้ด..."
              className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
            
            {/* Autocomplete Results */}
            {showResults && filteredResults.length > 0 && (
              <div className="absolute z-10 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {filteredResults.map(item => (
                  <button
                    key={item.itemId}
                    type="button"
                    onClick={() => addToCart(item)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 flex flex-col border-b border-gray-50 last:border-none"
                  >
                    <span className="text-sm font-bold text-gray-900">{item.name}</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase">ID: {item.itemId}</span>
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
          <button type="submit" className="bg-blue-50 text-blue-600 px-6 rounded-xl font-bold text-sm hover:bg-blue-100 transition-colors relative z-10">
            เพิ่ม
          </button>
        </form>
      </div>

      {/* Cart Area */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            รายการในตะกร้า 
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-[10px]">{cart.length}</span>
          </h2>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-xs font-bold text-red-500 uppercase tracking-widest">ล้างตะกร้า</button>
          )}
        </div>

        {cart.length === 0 ? (
          <div className="bg-gray-50/50 border-2 border-dashed border-gray-100 rounded-3xl p-12 text-center">
            <PackagePlus className="mx-auto text-gray-200 mb-4" size={48} />
            <p className="text-gray-400 text-sm">ยังไม่มีรายการในตะกร้า<br/>เริ่มแสกนเพื่อทำรายการรับเข้า</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map((item) => (
              <div key={item.cartId} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 truncate">{item.name}</h3>
                  <div className="flex flex-wrap gap-x-3 gap-y-2 mt-2 text-[11px] font-medium text-gray-500">
                    <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded flex items-center">ID: {item.itemId}</span>
                    <div className="flex items-center gap-1">
                      <span className="bg-gray-50 px-1.5 py-0.5 rounded font-mono">Lot:</span>
                      <input 
                        type="text" 
                        value={item.lotNo} 
                        onChange={e => updateLotNo(item.cartId, e.target.value)}
                        placeholder="ระบุ Lot"
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-blue-500 w-24"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="bg-gray-50 px-1.5 py-0.5 rounded">EXP:</span>
                      <input 
                        type="date" 
                        value={item.expDate} 
                        onChange={e => updateExpDate(item.cartId, e.target.value)}
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <input 
                      type="number"
                      value={item.qty}
                      onChange={(e) => updateQty(item.cartId, e.target.value)}
                      className="w-16 text-center font-bold bg-gray-50 border border-gray-100 rounded-lg py-1.5 text-blue-600 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-gray-400 uppercase whitespace-nowrap">{item.unit}</span>
                  </div>
                  <button 
                    onClick={() => removeFromCart(item.cartId)}
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
                className="w-full bg-green-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all active:scale-[0.98] shadow-lg shadow-green-100 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
                ยืนยันการรับเข้า {cart.length} รายการ
              </button>
            </div>
          </div>
        )}
      </div>

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
