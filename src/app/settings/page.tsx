'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { X } from 'lucide-react';

interface SettingData {
  reagentTypes: string[];
  jobTypes: string[];
  machineTypes: string[];
  departments: string[];
}

type SettingType = 'reagent' | 'job' | 'machine' | 'department';
type NewValues = Record<SettingType, string>;

interface SectionProps {
  title: string;
  type: SettingType;
  items: string[];
  placeholder: string;
  loading: boolean;
  newValue: NewValues;
  setNewValue: React.Dispatch<React.SetStateAction<NewValues>>;
  onAdd: (type: SettingType) => void;
  onDelete: (type: SettingType, value: string) => void;
}

const Section = ({ title, type, items, placeholder, loading, newValue, setNewValue, onAdd, onDelete }: SectionProps) => (
  <section aria-label={title} className="flex min-w-0 flex-col rounded-2xl border border-line bg-white p-5">
    <h3 className="mb-3 text-[17px] font-medium">
      {title} <span className="font-normal text-gray-600">{loading ? '' : items.length}</span>
    </h3>

    <div className="mb-3 h-72 overflow-y-auto rounded-xl border border-line">
      {loading ? (
        <p className="px-3.5 py-4 text-sm text-gray-600">กำลังโหลด...</p>
      ) : items.length === 0 ? (
        <p className="px-3.5 py-4 text-sm text-gray-600">ยังไม่มีข้อมูล</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item} className="flex items-center gap-2 px-3.5 py-2 text-sm hover:bg-[#fafafa]">
              <span className="min-w-0 flex-1 break-words">{item}</span>
              <button
                type="button"
                onClick={() => onDelete(type, item)}
                aria-label={`ลบ ${item}`}
                className="inline-flex shrink-0 rounded-[8px] p-1.5 text-gray-600 hover:bg-crit-bg hover:text-crit"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>

    <form
      className="mt-auto flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(type);
      }}
    >
      <input
        type="text"
        placeholder={placeholder}
        aria-label={`เพิ่ม${title}`}
        value={newValue[type]}
        onChange={(e) => setNewValue({ ...newValue, [type]: e.target.value })}
        className="min-h-[38px] w-full min-w-0 rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10"
      />
      <button type="submit" className="inline-flex items-center rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink transition hover:bg-gray-50">
        เพิ่ม
      </button>
    </form>
  </section>
);

export default function SettingsPage() {
  const [data, setData] = useState<SettingData>({
    reagentTypes: [],
    jobTypes: [],
    machineTypes: [],
    departments: []
  });
  const [loading, setLoading] = useState(true);
  const [newValue, setNewValue] = useState<NewValues>({ reagent: '', job: '', machine: '', department: '' });

  const fetchSettings = useCallback(async () => {
    try {
      const settings = await apiClient.getSettings();
      setData({ ...settings, departments: settings.departments ?? [] });
    } catch (error) {
      console.error('Fetch settings error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (isMounted) {
        await fetchSettings();
      }
    };
    load();
    return () => { isMounted = false; };
  }, [fetchSettings]);

  const handleAdd = async (type: SettingType) => {
    const value = newValue[type].trim();
    if (!value) return;

    try {
      const res = await apiClient.updateSettings('add', type, value);
      if (res.success) {
        setNewValue({ ...newValue, [type]: '' });
        fetchSettings();
      }
    } catch {
      alert('เกิดข้อผิดพลาดในการเพิ่มข้อมูล');
    }
  };

  const handleDelete = async (type: SettingType, value: string) => {
    if (!confirm(`คุณต้องการลบ "${value}" ใช่หรือไม่?`)) return;

    try {
      const res = await apiClient.updateSettings('delete', type, value);
      if (res.success) {
        fetchSettings();
      }
    } catch {
      alert('เกิดข้อผิดพลาดในการลบข้อมูล');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div>
        <h1 className="text-[32px] leading-tight font-medium text-ink">ตั้งค่าระบบ (System Settings)</h1>
        <p className="mt-1.5 text-[15px] text-gray-600">รายการพื้นฐานที่ใช้เป็นตัวเลือกใน Master Data, หน้ารับน้ำยา และหน้าจัดการผู้ใช้</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Section
          title="ประเภทน้ำยา"
          type="reagent"
          items={data.reagentTypes}
          placeholder="เพิ่มประเภทน้ำยา (เช่น Serology...)"
          loading={loading}
          newValue={newValue}
          setNewValue={setNewValue}
          onAdd={handleAdd}
          onDelete={handleDelete}
        />
        <Section
          title="ประเภทงาน"
          type="job"
          items={data.jobTypes}
          placeholder="เพิ่มประเภทงาน (เช่น Routine...)"
          loading={loading}
          newValue={newValue}
          setNewValue={setNewValue}
          onAdd={handleAdd}
          onDelete={handleDelete}
        />
        <Section
          title="ประเภทเครื่อง"
          type="machine"
          items={data.machineTypes}
          placeholder="เพิ่มชื่อเครื่อง (เช่น Architect...)"
          loading={loading}
          newValue={newValue}
          setNewValue={setNewValue}
          onAdd={handleAdd}
          onDelete={handleDelete}
        />
        <Section
          title="หน่วยงาน"
          type="department"
          items={data.departments}
          placeholder="เพิ่มหน่วยงาน (เช่น ห้องปฏิบัติการเคมีคลินิก...)"
          loading={loading}
          newValue={newValue}
          setNewValue={setNewValue}
          onAdd={handleAdd}
          onDelete={handleDelete}
        />
      </div>

      <p className="text-xs text-gray-600">
        การลบรายการที่นี่ไม่กระทบข้อมูลเดิมที่เคยบันทึกไว้แล้ว แต่จะไม่มีชื่อนั้นให้เลือกในครั้งต่อไป
      </p>
    </div>
  );
}
