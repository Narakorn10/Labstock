'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient, Reagent } from '@/lib/api-client';
import { processAnyBarcode } from '@/lib/barcode-parser';
import QRScanner from '@/components/qr-scanner';
import { 
  ArrowLeftRight, 
  Camera, 
  Search, 
  Trash2, 
  Loader2, 
  CheckCircle,
  XCircle,
  Building2,
  Calendar
} from 'lucide-react';

interface BorrowCartItem {
  itemId: string;
  name: string;
  lotNo: string;
  expDate: string;
  qty: number;
  unit: string;
  origin: string; // ยืมมาจากไหน
}

export default function BorrowPage() {
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState('');
  const [globalOrigin, setGlobalOrigin] = useState(''); // หน่วยงานที่ยืม (ตั้งค่าเริ่มต้นสำหรับทั้งตะกร้า)
  const [cart, setCart] = useState<BorrowCartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

  // Load reagents for lookup
  useEffect(() => {
    apiClient.getDashboard().then(data => {
      setReagents(data);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  const handleScan = useCallback((decodedText: string) => {
    const data = processAnyBarcode(decodedText);
    if (!data) return;

    // Standardize GTIN for lookup (remove leading zeros)
    const cleanGtin = data.gtin.replace(/^0+/, '');
    const cleanRaw = data.rawString.replace(/^0+/, '');

    const match = reagents.find(r => {
      const dbBarcode = r.qrCode?.replace(/^0+/, '') || '';
      const dbItemId = r.itemId.replace(/^0+/, '');

      return (
        dbItemId.toLowerCase() === cleanGtin.toLowerCase() || 
        dbBarcode.toLowerCase() === cleanGtin.toLowerCase() ||
        dbItemId.toLowerCase() === cleanRaw.toLowerCase()
      );
    });

    if (match) {
      const newItem: BorrowCartItem = {
        itemId: match.itemId,
        name: match.name,
        lotNo: data.lot === 'NEED_MANUAL_INPUT' ? '' : data.lot,
        expDate: data.expDate === 'NEED_MANUAL_INPUT' ? '' : data.expDate,
        qty: 1,
        unit: match.unit,
        origin: globalOrigin
      };

      setCart(prev => {
        const existing = prev.find(i => i.itemId === newItem.itemId && i.lotNo === newItem.lotNo);
        if (existing) {
          return prev.map(i => i === existing ? { ...i, qty: i.qty + 1 } : i);
        }
        return [newItem, ...prev];
      });

      setScanMode(false);
      setSearch('');
      setFeedback({ type: 'success', msg: `เพิ่มรายการยืม ${match.name} แล้ว` });
    } else {
      setFeedback({ type: 'error', msg: 'ไม่พบข้อมูลน้ำยานี้ในระบบ Master Data' });
      setScanMode(false);
    }
  }, [reagents, globalOrigin]);

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    handleScan(search);
  };

  const removeFromCart = (index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };

  const updateQty = (index: number, newQty: string) => {
    const val = parseInt(newQty) || 0;
    setCart(prev => prev.map((item, i) => i === index ? { ...item, qty: val } : item));
  };

  const handleSubmit = async () => {
    if (cart.length === 0) return;
    if (!globalOrigin) {
      setFeedback({ type: 'error', msg: 'กรุณาระบุหน่วยงานที่ยืมมา' });
      return;
    }
    
    setSubmitting(true);
    try {
      // Reuse receiveBatch for now but tag as "BORROW" in logic if needed
      // For now, let's assume it increases inventory like a receive
      await apiClient.receiveBatch(cart.map(i => ({ ...i, note: `BORROW FROM: ${globalOrigin}` })));
      setFeedback({ type: 'success', msg: 'บันทึกรายการยืมน้ำยาสำเร็จ' });
      setCart([]);
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
        <Loader2 className="animate-spin text-indigo-600" size={48} />
        <p className="text-gray-500 animate-pulse font-bold text-xs">กำลังเตรียมระบบยืมน้ำยา...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
            <ArrowLeftRight size={28} />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">ยืมน้ำยา (Borrow)</h1>
        </div>
        <p className="text-gray-500 text-sm font-bold">บันทึกการนำน้ำยาจากหน่วยงานอื่นมาเข้าคลัง</p>
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

      {/* Global Config Area (Origin) */}
      <div className="bg-white p-6 rounded-3xl border-2 border-indigo-100 shadow-sm space-y-4">
        <label className="block text-[10px] font-black text-indigo-600 uppercase tracking-widest">หน่วยงานที่ยืมมา (Origin)</label>
        <div className="relative">
          <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text"
            value={globalOrigin}
            onChange={(e) => setGlobalOrigin(e.target.value)}
            placeholder="ระบุชื่อแผนก หรือ โรงพยาบาล..."
            className="w-full pl-11 pr-4 py-4 bg-indigo-50/30 border border-indigo-100 rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Action Area */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
        <button 
          onClick={() => setScanMode(true)}
          className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all active:scale-[0.98] shadow-lg shadow-indigo-200"
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาด่วน หรือ พิมพ์รหัส..."
              className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button type="submit" className="bg-indigo-50 text-indigo-600 px-6 rounded-xl font-black text-sm hover:bg-indigo-100 transition-colors">
            เพิ่ม
          </button>
        </form>
      </div>

      {/* Cart Area */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="font-black text-gray-800 flex items-center gap-2">
            ตะกร้าการยืม 
            <span className="bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full text-[10px]">{cart.length}</span>
          </h2>
        </div>

        {cart.length === 0 ? (
          <div className="bg-gray-50/50 border-2 border-dashed border-gray-200 rounded-3xl p-12 text-center">
            <ArrowLeftRight className="mx-auto text-gray-300 mb-4" size={48} />
            <p className="text-gray-400 text-sm font-bold">ยังไม่มีรายการยืม<br/>เริ่มแสกนน้ำยาที่ต้องการบันทึก</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map((item, index) => (
              <div key={`${item.itemId}-${item.lotNo}-${index}`} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 truncate text-sm">{item.name}</h3>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-[10px] font-black">Lot: {item.lotNo || '-'}</span>
                    <span className="bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded text-[10px] font-black flex items-center gap-1">
                      <Calendar size={10} />
                      {item.expDate || 'ไม่ระบุ EXP'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <input 
                    type="number"
                    value={item.qty}
                    onChange={(e) => updateQty(index, e.target.value)}
                    className="w-14 text-center font-black bg-gray-50 border border-gray-200 rounded-lg py-2 text-indigo-600 text-lg outline-none focus:ring-2 focus:ring-indigo-500"
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
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all active:scale-[0.98] shadow-lg shadow-indigo-200 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
                ยืนยันการบันทึกยืม {cart.length} รายการ
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
