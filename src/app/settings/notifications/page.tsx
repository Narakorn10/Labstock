"use client";

import { useState, useEffect } from "react";

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    fetchSession();
  }, []);

  const fetchSession = async () => {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.user?.username) {
          fetchSettings(data.user.username);
        } else {
          setLoading(false);
        }
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const fetchSettings = async (username: string) => {
    try {
      const res = await fetch(`/api/settings/notifications?username=${username}`);
      if (res.ok) {
        setSettings(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, username: user.username })
      });
      if (res.ok) {
        alert("บันทึกการตั้งค่าสำเร็จ");
      } else {
        alert("เกิดข้อผิดพลาดในการบันทึก");
      }
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: string, value: any) => {
    setSettings({ ...settings, [field]: value });
  };

  if (loading) return <div className="p-6">Loading...</div>;
  if (!user) return <div className="p-6">กรุณาเข้าสู่ระบบ</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">ตั้งค่าการแจ้งเตือน (Notification Settings)</h1>

      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-bold mb-4 border-b pb-2">ช่องทางการติดต่อ</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input 
              type="email" 
              value={settings?.email || ''} 
              onChange={e => handleChange('email', e.target.value)}
              placeholder="example@email.com"
              className="w-full max-w-md border rounded p-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="text-xs text-gray-500 mt-1">ใช้สำหรับรับอีเมลสรุป หรือแจ้งเตือนสถานะต่างๆ</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">LINE User ID (สำหรับการแจ้งเตือนผ่าน Bot)</label>
            <div className="flex gap-2 items-center">
              <input 
                type="text" 
                value={settings?.line_user_id || ''} 
                onChange={e => handleChange('line_user_id', e.target.value)}
                placeholder="U1234567890abcdef..."
                className="w-full max-w-md border rounded p-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <a href="https://developers.line.biz/" target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">
                วิธีหา LINE User ID?
              </a>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              เพิ่มเพื่อน LINE Bot ของระบบ แล้วพิมพ์ "ลงทะเบียน" เพื่อรับ User ID
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-bold mb-4 border-b pb-2">รับการแจ้งเตือนเมื่อ</h2>
        
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input 
              type="checkbox" 
              checked={settings?.notify_po_created || false} 
              onChange={e => handleChange('notify_po_created', e.target.checked)}
              className="w-5 h-5 text-indigo-600 rounded"
            />
            <span>มีการสร้างใบสั่งซื้อใหม่ (PO Created)</span>
          </label>
          <label className="flex items-center gap-3">
            <input 
              type="checkbox" 
              checked={settings?.notify_po_confirmed || false} 
              onChange={e => handleChange('notify_po_confirmed', e.target.checked)}
              className="w-5 h-5 text-indigo-600 rounded"
            />
            <span>Vendor ยืนยัน/ปฏิเสธ ออเดอร์ (PO Confirmed)</span>
          </label>
          <label className="flex items-center gap-3">
            <input 
              type="checkbox" 
              checked={settings?.notify_po_shipped || false} 
              onChange={e => handleChange('notify_po_shipped', e.target.checked)}
              className="w-5 h-5 text-indigo-600 rounded"
            />
            <span>Vendor แจ้งส่งสินค้าแล้ว (PO Shipped)</span>
          </label>
          <label className="flex items-center gap-3">
            <input 
              type="checkbox" 
              checked={settings?.notify_po_received || false} 
              onChange={e => handleChange('notify_po_received', e.target.checked)}
              className="w-5 h-5 text-indigo-600 rounded"
            />
            <span>Lab รับสินค้าเข้าสต๊อกแล้ว (PO Received)</span>
          </label>
          <label className="flex items-center gap-3">
            <input 
              type="checkbox" 
              checked={settings?.notify_low_stock || false} 
              onChange={e => handleChange('notify_low_stock', e.target.checked)}
              className="w-5 h-5 text-indigo-600 rounded"
            />
            <span>มีสินค้าน้ำยาที่ต่ำกว่า Min Stock (Low Stock Alert)</span>
          </label>
        </div>
      </div>

      <div className="flex justify-end">
        <button 
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-indigo-600 text-white rounded shadow hover:bg-indigo-700 disabled:opacity-50 font-medium"
        >
          {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
        </button>
      </div>
    </div>
  );
}
