"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import {
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
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
      <Loader2 className="animate-spin text-gray-600" size={40} />
      <p className="text-sm text-gray-600">กำลังโหลดข้อมูลการตั้งค่า...</p>
    </div>
  );

  if (!user) return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
      <AlertCircle className="text-crit" size={48} />
      <p className="text-xl font-medium text-ink">กรุณาเข้าสู่ระบบ</p>
    </div>
  );

  const fieldClass = 'min-h-[38px] w-full min-w-0 rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10';
  const testBtnClass = 'inline-flex shrink-0 items-center gap-2 rounded-[10px] border border-line bg-white px-3 py-[9px] text-sm font-medium text-ink transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';

  const events = [
    { id: 'notify_po_created', label: 'มีการสร้างใบสั่งน้ำยาใหม่', sub: 'สร้างใบสั่งน้ำยา' },
    { id: 'notify_po_confirmed', label: 'Vendor ยืนยัน/ปฏิเสธ ใบสั่งน้ำยา', sub: 'ยืนยันหรือปฏิเสธใบสั่งน้ำยา' },
    { id: 'notify_po_shipped', label: 'Vendor แจ้งส่งสินค้าแล้ว', sub: 'แจ้งส่งใบสั่งน้ำยา' },
    { id: 'notify_po_received', label: 'Lab รับสินค้าเข้าสต๊อกแล้ว', sub: 'รับใบสั่งน้ำยาเข้าสต็อก' },
    { id: 'notify_low_stock', label: 'น้ำยาต่ำกว่าระดับสำรอง', sub: 'Low Stock Alert' },
    { id: 'notify_expiring_soon', label: 'น้ำยาใกล้หมดอายุภายใน 30 วัน', sub: 'Expiring Soon Alert' },
    { id: 'notify_weekly_summary', label: 'สรุปปริมาณน้ำยาคงเหลือประจำสัปดาห์', sub: 'Weekly Stock Summary' },
    { id: 'notify_reorder_risk', label: 'ความเสี่ยงต้องสั่งซื้อน้ำยา', sub: 'Weekly Reorder Risk (Monday 08:00)' },
  ];

  return (
    <div className="space-y-6 pb-12 animate-in fade-in">
      <div>
        <h1 className="text-[32px] leading-tight font-medium text-ink">การแจ้งเตือน (Notifications)</h1>
        <p className="mt-1.5 text-[15px] text-gray-600">เลือกช่องทางและเหตุการณ์ที่คุณต้องการรับการแจ้งเตือนจากระบบ</p>
      </div>

      <div className="grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        {/* Channels */}
        <section aria-labelledby="notify-channels" className="min-w-0 rounded-2xl border border-line bg-white p-5">
          <h2 id="notify-channels" className="mb-2 text-[17px] font-medium">ช่องทาง</h2>

          <div className="border-b border-line py-3">
            <div className="mb-2.5 flex items-center gap-3">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-[10px] bg-ground"><Mail size={18} /></span>
              <div>
                <div className="font-medium">อีเมล</div>
                <div className="text-xs text-gray-600">ใช้สำหรับรับอีเมลสรุป หรือแจ้งเตือนสถานะต่าง ๆ</div>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                aria-label="Email Address"
                value={settings?.email || ''}
                onChange={e => handleChange('email', e.target.value)}
                placeholder="example@email.com"
                className={fieldClass}
              />
              <button
                type="button"
                onClick={() => handleTest('email')}
                disabled={!settings?.email || testing === 'email'}
                className={testBtnClass}
                title="ทดสอบส่งอีเมล"
              >
                {testing === 'email' ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                ทดสอบ
              </button>
            </div>
          </div>

          <div className="py-3">
            <div className="mb-2.5 flex items-center gap-3">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-[10px] bg-ground"><MessageSquare size={18} /></span>
              <div>
                <div className="font-medium">LINE Bot Notification</div>
                <div className="text-xs text-gray-600">ส่งแจ้งเตือนเข้า LINE ของคุณ</div>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                aria-label="LINE User ID"
                value={settings?.line_user_id || ''}
                onChange={e => handleChange('line_user_id', e.target.value)}
                placeholder="U1234567890abcdef..."
                className={`${fieldClass} font-mono`}
              />
              <button
                type="button"
                onClick={() => handleTest('line')}
                disabled={!settings?.line_user_id || testing === 'line'}
                className={testBtnClass}
                title="ทดสอบส่ง LINE"
              >
                {testing === 'line' ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                ทดสอบ
              </button>
            </div>
            <div className="mt-3 rounded-xl bg-[#fafafa] px-3.5 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-[13px] font-medium"><HelpCircle size={14} /> วิธีหา LINE User ID?</p>
              <p className="text-xs leading-relaxed text-gray-600">
                เพิ่มเพื่อน LINE Bot ของระบบ แล้วพิมพ์ <code className="rounded border border-line bg-white px-1">id</code> หรือ <code className="rounded border border-line bg-white px-1">ลงทะเบียน</code> เพื่อรับ User ID ของคุณ
              </p>
            </div>
          </div>
        </section>

        {/* Events */}
        <section aria-labelledby="notify-events" className="min-w-0 rounded-2xl border border-line bg-white p-5">
          <h2 id="notify-events" className="mb-2 text-[17px] font-medium">เหตุการณ์ที่ต้องการรับการแจ้งเตือน</h2>
          <div>
            {events.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-center gap-3 border-b border-line py-3 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{item.label}</span>
                  <span className="block text-xs text-gray-600">{item.sub}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={Boolean(settings?.[item.id])}
                  onChange={e => handleChange(item.id, e.target.checked)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="relative inline-block h-[22px] w-10 shrink-0 rounded-full bg-gray-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-[18px] after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-[18px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gray-800"
                />
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-[10px] border border-ink bg-ink px-5 py-3 text-sm font-medium text-white transition hover:bg-black active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          บันทึกการตั้งค่าทั้งหมด
        </button>
      </div>
    </div>
  );
}
