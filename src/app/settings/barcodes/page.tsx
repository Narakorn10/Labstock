'use client';

import { useState, useEffect, useMemo } from 'react';
import { apiClient, BarcodePattern } from '@/lib/api-client';
import { processAnyBarcode } from '@/lib/barcode-parser';
import { Trash2, Plus, Loader2, CheckCircle, Save, Camera, X, AlertCircle } from 'lucide-react';
import QRScanner from '@/components/qr-scanner';

export default function BarcodeSettingsPage() {
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  
  const [name, setName] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [itemIdGroup, setItemIdGroup] = useState<number | ''>('');
  const [lotNoGroup, setLotNoGroup] = useState<number | ''>('');
  const [expDateGroup, setExpDateGroup] = useState<number | ''>('');

  const [testString, setTestString] = useState('');
  const [testResult, setTestResult] = useState<{ match: boolean, item?: string, lot?: string, exp?: string } | null>(null);
  const [isGS1Warning, setIsGS1Warning] = useState(false);
  
  const [saving, setSaving] = useState(false);
  
  // Assistant Mode States
  const [assistantMode, setAssistantMode] = useState(false);
  const [selection, setSelection] = useState<{ start: number, end: number } | null>(null);
  const [mapping, setMapping] = useState<{ item?: [number, number], lot?: [number, number], exp?: [number, number] }>({});

  const gs1Result = useMemo(() => {
    const data = processAnyBarcode(testString, []);
    return data?.barcodeType === 'GS1_COMPLIANT' ? data : null;
  }, [testString]);

  const loadPatterns = async () => {
    try {
      const data = await apiClient.getBarcodePatterns();
      setPatterns(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatterns();
  }, []);

  const generateRegexFromMapping = () => {
    if (!testString) return;
    
    // Sort mapped ranges to build positional regex
    const points: { pos: number, type: 'item' | 'lot' | 'exp' | 'skip', len: number }[] = [];
    
    if (mapping.item) points.push({ pos: mapping.item[0], type: 'item', len: mapping.item[1] - mapping.item[0] + 1 });
    if (mapping.lot) points.push({ pos: mapping.lot[0], type: 'lot', len: mapping.lot[1] - mapping.lot[0] + 1 });
    if (mapping.exp) points.push({ pos: mapping.exp[0], type: 'exp', len: mapping.exp[1] - mapping.exp[0] + 1 });
    
    points.sort((a, b) => a.pos - b.pos);
    
    let regex = '^';
    let currentPos = 0;
    let groupIdx = 1;
    let newItemIdx = 0, newLotIdx = 0, newExpIdx = 0;

    points.forEach(p => {
      if (p.pos > currentPos) {
        regex += `.{${p.pos - currentPos}}`;
      }
      regex += `(.{${p.len}})`;
      if (p.type === 'item') newItemIdx = groupIdx;
      if (p.type === 'lot') newLotIdx = groupIdx;
      if (p.type === 'exp') newExpIdx = groupIdx;
      
      currentPos = p.pos + p.len;
      groupIdx++;
    });
    
    regex += '.*$';
    
    setRegexPattern(regex);
    setItemIdGroup(newItemIdx || '');
    setLotNoGroup(newLotIdx || '');
    setExpDateGroup(newExpIdx || '');
  };

  useEffect(() => {
    if (assistantMode && (mapping.item || mapping.lot || mapping.exp)) {
      generateRegexFromMapping();
    }
  }, [mapping, assistantMode]);

  const handleCharClick = (idx: number) => {
    if (!selection) {
      setSelection({ start: idx, end: idx });
    } else if (selection.start === selection.end && idx !== selection.start) {
      // Set end point
      const start = Math.min(selection.start, idx);
      const end = Math.max(selection.start, idx);
      setSelection({ start, end });
    } else {
      // Reset
      setSelection({ start: idx, end: idx });
    }
  };

  const applySelection = (type: 'item' | 'lot' | 'exp') => {
    if (!selection) return;
    setMapping(prev => ({ ...prev, [type]: [selection.start, selection.end] }));
    setSelection(null);
  };

  const clearAssistant = () => {
    setMapping({});
    setSelection(null);
    setRegexPattern('');
    setItemIdGroup('');
    setLotNoGroup('');
    setExpDateGroup('');
  };

  const handleScan = (text: string) => {
    setShowScanner(false);
    setTestString(text);
  };

  const checkGS1Format = (text: string) => {
    return processAnyBarcode(text, [])?.barcodeType === 'GS1_COMPLIANT';
  };

  const runTest = () => {
    if (!regexPattern || !testString) return;
    
    setIsGS1Warning(checkGS1Format(testString));

    try {
      const regex = new RegExp(regexPattern);
      const match = testString.match(regex);
      if (match) {
        setTestResult({
          match: true,
          item: itemIdGroup ? match[Number(itemIdGroup)] : undefined,
          lot: lotNoGroup ? match[Number(lotNoGroup)] : undefined,
          exp: expDateGroup ? match[Number(expDateGroup)] : undefined
        });
      } else {
        setTestResult({ match: false });
      }
    } catch (e) {
      setTestResult({ match: false });
    }
  };

  useEffect(() => {
    if (regexPattern && testString) {
      runTest();
    }
  }, [regexPattern, testString, itemIdGroup, lotNoGroup, expDateGroup]);

  const handleSave = async () => {
    if (!name || !regexPattern) return alert("กรุณาระบุชื่อและ Regex Pattern");
    setSaving(true);
    try {
      await apiClient.createBarcodePattern({
        name,
        regex_pattern: regexPattern,
        item_id_group: itemIdGroup ? Number(itemIdGroup) : null,
        lot_no_group: lotNoGroup ? Number(lotNoGroup) : null,
        exp_date_group: expDateGroup ? Number(expDateGroup) : null,
      });
      setName('');
      setRegexPattern('');
      setItemIdGroup('');
      setLotNoGroup('');
      setExpDateGroup('');
      setTestString('');
      setTestResult(null);
      loadPatterns();
    } catch (e: any) {
      alert("Error: " + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('ยืนยันการลบรูปแบบนี้?')) return;
    try {
      await apiClient.deleteBarcodePattern(id);
      loadPatterns();
    } catch (e) {
      alert("Error deleting");
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in pb-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">ตั้งค่า Barcode/QR Code (Smart Parser)</h1>
      </div>

      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Plus className="text-blue-600" />
          สอนระบบอ่านบาร์โค้ดใหม่
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
              <input 
                type="checkbox" 
                id="assistant" 
                checked={assistantMode} 
                onChange={e => setAssistantMode(e.target.checked)} 
                className="w-4 h-4 accent-blue-600"
              />
              <label htmlFor="assistant" className="text-sm font-bold text-blue-700 cursor-pointer">เปิดโหมดผู้ช่วย (Assistant Mode)</label>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">ชื่อรูปแบบ (เช่น Roche Custom)</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-xl px-4 py-2" placeholder="ชื่อรูปแบบ" />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Regular Expression (Regex)</label>
              <input type="text" value={regexPattern} onChange={e => setRegexPattern(e.target.value)} className={`w-full border rounded-xl px-4 py-2 font-mono ${assistantMode ? 'bg-gray-50' : ''}`} placeholder="^(.{10})(.{6})(.{8})$" readOnly={assistantMode} />
              {assistantMode && <p className="text-[10px] text-blue-600 mt-1 font-bold">* Regex จะถูกสร้างอัตโนมัติจากโหมดผู้ช่วย</p>}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Item ID Group</label>
                <input type="number" value={itemIdGroup} onChange={e => setItemIdGroup(e.target.value ? Number(e.target.value) : '')} className={`w-full border rounded-xl px-4 py-2 ${assistantMode ? 'bg-gray-50' : ''}`} placeholder="เช่น 1" readOnly={assistantMode} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Lot No Group</label>
                <input type="number" value={lotNoGroup} onChange={e => setLotNoGroup(e.target.value ? Number(e.target.value) : '')} className={`w-full border rounded-xl px-4 py-2 ${assistantMode ? 'bg-gray-50' : ''}`} placeholder="เช่น 2" readOnly={assistantMode} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Exp Date Group</label>
                <input type="number" value={expDateGroup} onChange={e => setExpDateGroup(e.target.value ? Number(e.target.value) : '')} className={`w-full border rounded-xl px-4 py-2 ${assistantMode ? 'bg-gray-50' : ''}`} placeholder="เช่น 3" readOnly={assistantMode} />
              </div>
            </div>
          </div>

          <div className="space-y-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center justify-between">
                1. แสกนหรือวางบาร์โค้ดที่นี่
                <button onClick={() => setShowScanner(true)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded flex items-center gap-1 hover:bg-blue-200">
                  <Camera size={14} /> แสกนทดสอบ
                </button>
              </label>
              <input type="text" value={testString} onChange={e => setTestString(e.target.value)} className="w-full border rounded-xl px-4 py-2 font-mono" placeholder="วางบาร์โค้ดที่นี่เพื่อทดสอบ" />
            </div>

            {gs1Result && (
              <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-emerald-700 font-bold">
                  <CheckCircle size={18} /> GS1 UDI decoded automatically
                </div>
                <div><strong>GTIN (UDI-DI):</strong> <span className="font-mono">{gs1Result.gtin}</span></div>
                <div><strong>REF (240):</strong> <span className="font-mono">{gs1Result.additionalProductId || '-'}</span></div>
                <div><strong>Lot (10):</strong> <span className="font-mono">{gs1Result.lot === 'NEED_MANUAL_INPUT' ? '-' : gs1Result.lot}</span></div>
                <div><strong>Expiry (17):</strong> <span className="font-mono">{gs1Result.expDate === 'NEED_MANUAL_INPUT' ? '-' : gs1Result.expDate}</span></div>
                <div><strong>Manufacturing (11):</strong> <span className="font-mono">{gs1Result.mfgDate === 'NEED_MANUAL_INPUT' ? '-' : gs1Result.mfgDate}</span></div>
                <div><strong>Serial (21):</strong> <span className="font-mono">{gs1Result.serial === 'NEED_MANUAL_INPUT' ? '-' : gs1Result.serial}</span></div>
                <div className="break-all"><strong>Full UDI:</strong> <span className="font-mono">{gs1Result.udi}</span></div>
              </div>
            )}

            {assistantMode && testString && (
              <div className="bg-white p-4 rounded-xl border border-blue-200 space-y-4 shadow-sm">
                <div className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">2. เลือกช่วงตัวอักษรที่ต้องการ</div>
                <div className="flex flex-wrap gap-1 font-mono text-sm leading-none bg-gray-50 p-2 rounded-lg border border-gray-100 select-none">
                  {testString.split('').map((char, idx) => {
                    const isSelected = selection && idx >= selection.start && idx <= selection.end;
                    const isItem = mapping.item && idx >= mapping.item[0] && idx <= mapping.item[1];
                    const isLot = mapping.lot && idx >= mapping.lot[0] && idx <= mapping.lot[1];
                    const isExp = mapping.exp && idx >= mapping.exp[0] && idx <= mapping.exp[1];
                    
                    let bgColor = 'bg-white';
                    let textColor = 'text-gray-600';
                    let borderColor = 'border-gray-200';
                    
                    if (isSelected) { bgColor = 'bg-blue-600'; textColor = 'text-white'; borderColor = 'border-blue-700'; }
                    else if (isItem) { bgColor = 'bg-green-100'; textColor = 'text-green-700'; borderColor = 'border-green-300'; }
                    else if (isLot) { bgColor = 'bg-purple-100'; textColor = 'text-purple-700'; borderColor = 'border-purple-300'; }
                    else if (isExp) { bgColor = 'bg-orange-100'; textColor = 'text-orange-700'; borderColor = 'border-orange-300'; }

                    return (
                      <span 
                        key={idx} 
                        onClick={() => handleCharClick(idx)}
                        className={`cursor-pointer w-6 h-8 flex items-center justify-center rounded border transition-all ${bgColor} ${textColor} ${borderColor} hover:scale-105 active:scale-95`}
                      >
                        {char}
                      </span>
                    );
                  })}
                </div>
                
                <div className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">3. กำหนดประเภท</div>
                <div className="grid grid-cols-3 gap-2">
                  <button 
                    onClick={() => applySelection('item')} 
                    disabled={!selection}
                    className="px-2 py-2 bg-green-600 text-white rounded-lg text-[10px] font-bold disabled:opacity-30 hover:bg-green-700"
                  >
                    เป็น Item ID
                  </button>
                  <button 
                    onClick={() => applySelection('lot')} 
                    disabled={!selection}
                    className="px-2 py-2 bg-purple-600 text-white rounded-lg text-[10px] font-bold disabled:opacity-30 hover:bg-purple-700"
                  >
                    เป็น Lot No
                  </button>
                  <button 
                    onClick={() => applySelection('exp')} 
                    disabled={!selection}
                    className="px-2 py-2 bg-orange-600 text-white rounded-lg text-[10px] font-bold disabled:opacity-30 hover:bg-orange-700"
                  >
                    เป็น Exp Date
                  </button>
                </div>
                <button 
                  onClick={clearAssistant} 
                  className="w-full py-1 text-[10px] font-bold text-gray-400 hover:text-red-500 transition-colors"
                >
                  ล้างการเลือกทั้งหมด
                </button>
              </div>
            )}

            {!assistantMode && testString && regexPattern && testResult && (
              <div className={`p-4 rounded-xl border ${testResult.match ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                {isGS1Warning && (
                  <div className="mb-4 p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-sm flex items-start gap-2">
                    <AlertCircle className="shrink-0 mt-0.5" size={16} />
                    <div>
                      <strong>แจ้งเตือนความเสี่ยง:</strong> บาร์โค้ดนี้ดูเหมือนจะใช้มาตรฐาน GS1 อยู่แล้ว (ระบบเดิมอ่านได้) 
                      การสอนรูปแบบใหม่ทับซ้อนลงไปอาจทำให้ระบบดึงข้อมูลผิดพลาด แนะนำให้ใช้บาร์โค้ดที่ระบบเดิมอ่านไม่ได้จริงๆ ครับ
                    </div>
                  </div>
                )}
                
                {testResult.match ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-green-700 font-bold mb-2">
                      <CheckCircle size={18} /> Match Success!
                    </div>
                    <div className="text-sm"><strong>Item ID:</strong> {testResult.item || '-'}</div>
                    <div className="text-sm"><strong>Lot No:</strong> {testResult.lot || '-'}</div>
                    <div className="text-sm"><strong>Exp Date:</strong> {testResult.exp || '-'}</div>
                  </div>
                ) : (
                  <div className="text-red-700 font-bold">❌ ไม่ตรงกับ Regex Pattern</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving || !name || !regexPattern} className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} บันทึกรูปแบบ
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold">รูปแบบที่เรียนรู้แล้ว ({patterns.length})</h2>
        <div className="grid gap-4">
          {patterns.map(p => (
            <div key={p.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">{p.name}</h3>
                <code className="text-sm text-pink-600 bg-pink-50 px-2 py-0.5 rounded">{p.regex_pattern}</code>
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  <span>Item Group: {p.item_id_group || '-'}</span>
                  <span>Lot Group: {p.lot_no_group || '-'}</span>
                  <span>Exp Group: {p.exp_date_group || '-'}</span>
                </div>
              </div>
              <button onClick={() => handleDelete(p.id)} className="text-gray-400 hover:text-red-500 p-2">
                <Trash2 size={20} />
              </button>
            </div>
          ))}
          {patterns.length === 0 && (
            <div className="text-center p-8 text-gray-400 bg-gray-50 rounded-2xl">ยังไม่มีรูปแบบที่บันทึกไว้</div>
          )}
        </div>
      </div>

      {showScanner && (
        <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}
    </div>
  );
}
