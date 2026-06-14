'use client';

import { useState, useEffect } from 'react';
import { apiClient, BarcodePattern } from '@/lib/api-client';
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

  useEffect(() => {
    loadPatterns();
  }, []);

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

  const handleScan = (text: string) => {
    setShowScanner(false);
    setTestString(text);
  };

  const checkGS1Format = (text: string) => {
    const cleanText = text.trim().replace(/^\][a-zA-Z0-9]{2}/, "").replace(/[()]/g, "").replace(/\s/g, "");
    // Check if it has GTIN (01 + 14 digits)
    if (cleanText.match(/01(\d{14})/)) {
      return true;
    }
    return false;
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
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">ชื่อรูปแบบ (เช่น Roche Custom)</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-xl px-4 py-2" placeholder="ชื่อรูปแบบ" />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Regular Expression (Regex)</label>
              <input type="text" value={regexPattern} onChange={e => setRegexPattern(e.target.value)} className="w-full border rounded-xl px-4 py-2 font-mono" placeholder="^(.{10})(.{6})(.{8})$" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Item ID Group</label>
                <input type="number" value={itemIdGroup} onChange={e => setItemIdGroup(e.target.value ? Number(e.target.value) : '')} className="w-full border rounded-xl px-4 py-2" placeholder="เช่น 1" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Lot No Group</label>
                <input type="number" value={lotNoGroup} onChange={e => setLotNoGroup(e.target.value ? Number(e.target.value) : '')} className="w-full border rounded-xl px-4 py-2" placeholder="เช่น 2" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Exp Date Group</label>
                <input type="number" value={expDateGroup} onChange={e => setExpDateGroup(e.target.value ? Number(e.target.value) : '')} className="w-full border rounded-xl px-4 py-2" placeholder="เช่น 3" />
              </div>
            </div>
          </div>

          <div className="space-y-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center justify-between">
                ทดสอบกับข้อความจริง
                <button onClick={() => setShowScanner(true)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded flex items-center gap-1 hover:bg-blue-200">
                  <Camera size={14} /> แสกนทดสอบ
                </button>
              </label>
              <input type="text" value={testString} onChange={e => setTestString(e.target.value)} className="w-full border rounded-xl px-4 py-2 font-mono" placeholder="วางบาร์โค้ดที่นี่เพื่อทดสอบ" />
            </div>

            {testString && regexPattern && testResult && (
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
