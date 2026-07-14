"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { 
  BellRing, 
  Mail, 
  MessageSquare, 
  AlertCircle, 
  Save, 
  Loader2, 
  Send, 
  HelpCircle
} from "lucide-react";

type NotificationSettings = {
  email: string;
  line_user_id: string;
  line_display_name?: string;
  notify_po_created: boolean;
  notify_po_confirmed: boolean;
  notify_po_shipped: boolean;
  notify_po_received: boolean;
  notify_low_stock: boolean;
  notify_expiring_soon: boolean;
  notify_weekly_summary: boolean;
  notify_reorder_risk: boolean;
  [key: string]: string | boolean | undefined;
};

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<'line' | 'email' | null>(null);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('labstock_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      if (!user?.username) {
        if (!cancelled) {
          setLoading(false);
        }
        return;
      }

      try {
        const res = await fetch(`/api/settings/notifications?username=${user.username}`, {
          headers: getAuthHeaders()
        });
        if (res.ok && !cancelled) {
          setSettings(await res.json());
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [user?.username]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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

  const handleTest = async (type: 'line' | 'email') => {
    if (!settings || !user) return;
    const value = type === 'line' ? settings.line_user_id : settings.email;
    if (!value) return;

    setTesting(type);
    try {
      const res = await fetch('/api/settings/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ type, value, username: user.username })
      });
      
      if (res.ok) {
        alert(`ส่งข้อความทดสอบ ${type.toUpperCase()} เรียบร้อยแล้ว! กรุณาตรวจสอบที่ ${type === 'line' ? 'แอป LINE' : 'กล่องจดหมาย'} ของคุณค่ะ`);
      } else {
        const err = await res.json();
        alert(`เกิดข้อผิดพลาด: ${err.error || 'ไม่สามารถส่งข้อความทดสอบได้'}`);
      }
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    } finally {
      setTesting(null);
    }
  };

  const handleChange = (field: string, value: string | boolean) => {
    setSettings((current) => current ? { ...current, [field]: value } : current);
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <Loader2 className="animate-spin text-blue-600" size={40} />
      <p className="text-gray-500 font-bold">กำลังโหลดข้อมูลการตั้งค่า...</p>
    </div>
  );

  if (!user) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <AlertCircle className="text-red-500" size={48} />
      <p className="text-gray-900 font-bold text-xl">กรุณาเข้าสู่ระบบ</p>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in pb-12">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-200">
            <BellRing size={24} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">การแจ้งเตือน (Notifications)</h1>
        </div>
        <p className="text-gray-500 text-sm ml-12">ตั้งค่าช่องทางและเหตุการณ์ที่คุณต้องการรับการแจ้งเตือนจากระบบ</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          {/* Email Settings */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2 text-gray-900">
              <Mail className="text-blue-600" size={20} />
              การแจ้งเตือนทางอีเมล
            </h2>
            
            <div className="space-y-3">
              <label className="block text-sm font-bold text-gray-700">Email Address</label>
              <div className="flex gap-2">
                <input 
                  type="email" 
                  value={settings?.email || ''} 
                  onChange={e => handleChange('email', e.target.value)}
                  placeholder="example@email.com"
                  className="flex-1 border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
                <button 
                  onClick={() => handleTest('email')}
                  disabled={!settings?.email || testing === 'email'}
                  className="px-3 bg-gray-50 text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100 transition-all disabled:opacity-30"
                  title="ทดสอบส่งอีเมล"
                >
                  <Send size={18} />
                </button>
              </div>
              <p className="text-[10px] text-gray-400">ใช้สำหรับรับอีเมลสรุป หรือแจ้งเตือนสถานะต่างๆ</p>
            </div>
          </div>

          {/* LINE Settings */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2 text-gray-900">
              <MessageSquare className="text-green-600" size={20} />
              LINE Bot Notification
            </h2>
            
            <div className="space-y-3">
              <label className="block text-sm font-bold text-gray-700">LINE User ID</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={settings?.line_user_id || ''} 
                  onChange={e => handleChange('line_user_id', e.target.value)}
                  placeholder="U1234567890abcdef..."
                  className="flex-1 border rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
                <button 
                  onClick={() => handleTest('line')}
                  disabled={!settings?.line_user_id || testing === 'line'}
                  className="px-3 bg-gray-50 text-green-600 border border-gray-200 rounded-xl hover:bg-green-50 transition-all disabled:opacity-30"
                  title="ทดสอบส่ง LINE"
                >
                  <Send size={18} />
                </button>
              </div>
              
              <div className="bg-blue-50 p-3 rounded-2xl border border-blue-100">
                <p className="text-[11px] text-blue-700 font-bold flex items-center gap-1 mb-1">
                  <HelpCircle size={12} /> วิธีหา LINE User ID?
                </p>
                <p className="text-[10px] text-blue-600 leading-relaxed">
                  เพิ่มเพื่อน LINE Bot ของระบบ แล้วพิมพ์ <code className="bg-white px-1 rounded border border-blue-200">id</code> หรือ <code className="bg-white px-1 rounded border border-blue-200">ลงทะเบียน</code> เพื่อรับ User ID ของคุณครับ
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Event Settings */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-6">
          <h2 className="text-lg font-bold flex items-center gap-2 text-gray-900">
            <BellRing className="text-orange-500" size={20} />
            เหตุการณ์ที่ต้องการรับการแจ้งเตือน
          </h2>
          
          <div className="space-y-1">
            {[
              { id: 'notify_po_created', label: 'มีการสร้างใบสั่งซื้อใหม่', sub: 'PO Created' },
              { id: 'notify_po_confirmed', label: 'Vendor ยืนยัน/ปฏิเสธ ออเดอร์', sub: 'PO Confirmed/Rejected' },
              { id: 'notify_po_shipped', label: 'Vendor แจ้งส่งสินค้าแล้ว', sub: 'PO Shipped' },
              { id: 'notify_po_received', label: 'Lab รับสินค้าเข้าสต๊อกแล้ว', sub: 'PO Received' },
              { id: 'notify_low_stock', label: 'น้ำยาต่ำกว่าระดับสำรอง', sub: 'Low Stock Alert' },
              { id: 'notify_expiring_soon', label: 'น้ำยาใกล้หมดอายุภายใน 30 วัน', sub: 'Expiring Soon Alert' },
              { id: 'notify_weekly_summary', label: 'สรุปปริมาณน้ำยาคงเหลือประจำสัปดาห์', sub: 'Weekly Stock Summary' },
              { id: 'notify_reorder_risk', label: 'ความเสี่ยงต้องสั่งซื้อน้ำยา', sub: 'Weekly Reorder Risk (Monday 08:00)' },
            ].map((item) => (
              <label 
                key={item.id} 
                className="flex items-center gap-4 p-3 rounded-2xl hover:bg-gray-50 transition-all cursor-pointer group"
              >
                <div className="relative flex items-center">
                  <input 
                    type="checkbox" 
                    checked={Boolean(settings?.[item.id])} 
                    onChange={e => handleChange(item.id, e.target.checked)}
                    className="w-5 h-5 accent-indigo-600 rounded-lg cursor-pointer"
                  />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-800 group-hover:text-indigo-600 transition-colors">{item.label}</p>
                  <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{item.sub}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-100 hover:bg-indigo-700 hover:shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          บันทึกการตั้งค่าทั้งหมด
        </button>
      </div>
    </div>
  );
}
