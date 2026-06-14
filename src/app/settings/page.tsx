'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { Settings, Plus, Trash2, Cpu, TestTube, Briefcase } from 'lucide-react';

interface SettingData {
  reagentTypes: string[];
  jobTypes: string[];
  machineTypes: string[];
}

interface SectionProps {
  title: string;
  icon: React.ElementType;
  type: 'reagent' | 'job' | 'machine';
  items: string[];
  placeholder: string;
  loading: boolean;
  newValue: { reagent: string; job: string; machine: string };
  setNewValue: React.Dispatch<React.SetStateAction<{ reagent: string; job: string; machine: string }>>;
  onAdd: (type: 'reagent' | 'job' | 'machine') => void;
  onDelete: (type: 'reagent' | 'job' | 'machine', value: string) => void;
}

const Section = ({ title, icon: Icon, type, items, placeholder, loading, newValue, setNewValue, onAdd, onDelete }: SectionProps) => (
  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col h-full">
    <div className="flex items-center gap-3 mb-6">
      <div className="bg-gray-50 p-2.5 rounded-xl text-gray-600">
        <Icon size={22} />
      </div>
      <h3 className="font-bold text-gray-900 text-lg">{title}</h3>
    </div>

    <div className="flex gap-2 mb-4">
      <input 
        type="text" 
        placeholder={placeholder}
        value={newValue[type]}
        onChange={(e) => setNewValue({ ...newValue, [type]: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && onAdd(type)}
        className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-sm"
      />
      <button 
        onClick={() => onAdd(type)}
        className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm"
      >
        <Plus size={20} />
      </button>
    </div>

    <div className="flex-1 overflow-y-auto max-h-[300px] space-y-2 custom-scrollbar pr-2">
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm italic">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm italic">ยังไม่มีข้อมูล</div>
      ) : items.map((item, idx) => (
        <div key={idx} className="flex items-center justify-between p-3 bg-gray-50/50 hover:bg-gray-50 rounded-xl border border-transparent hover:border-gray-200 transition-all group">
          <span className="text-gray-700 text-sm font-medium">{item}</span>
          <button 
            onClick={() => onDelete(type, item)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  </div>
);

export default function SettingsPage() {
  const [data, setData] = useState<SettingData>({
    reagentTypes: [],
    jobTypes: [],
    machineTypes: []
  });
  const [loading, setLoading] = useState(true);
  const [newValue, setNewValue] = useState({ reagent: '', job: '', machine: '' });

  const fetchSettings = useCallback(async () => {
    try {
      const settings = await apiClient.getSettings();
      setData(settings);
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

  const handleAdd = async (type: 'reagent' | 'job' | 'machine') => {
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

  const handleDelete = async (type: 'reagent' | 'job' | 'machine', value: string) => {
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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-xl text-white shadow-lg shadow-blue-200">
            <Settings size={24} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">ตั้งค่าระบบ (System Settings)</h1>
        </div>
        <p className="text-gray-500 text-sm ml-12">จัดการข้อมูลตัวเลือกใน Dropdown เช่น ประเภทน้ำยา, ประเภทงาน และชื่อเครื่องมือ</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Section 
          title="ประเภทน้ำยา" 
          icon={TestTube} 
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
          icon={Briefcase} 
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
          icon={Cpu} 
          type="machine" 
          items={data.machineTypes} 
          placeholder="เพิ่มชื่อเครื่อง (เช่น Architect...)"
          loading={loading}
          newValue={newValue}
          setNewValue={setNewValue}
          onAdd={handleAdd}
          onDelete={handleDelete}
        />
      </div>

      <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl flex gap-4">
        <div className="bg-amber-100 p-2.5 h-fit rounded-xl text-amber-600">
          <Plus size={24} />
        </div>
        <div>
          <h4 className="font-bold text-amber-900 mb-1">คำแนะนำการใช้งาน</h4>
          <p className="text-amber-800 text-sm leading-relaxed">
            ข้อมูลที่ตั้งค่าในหน้านี้จะไปปรากฏเป็นตัวเลือกให้เลือกในหน้า &quot;จัดการข้อมูลพื้นฐาน (Master Data)&quot; และหน้า &quot;รับน้ำยาเข้าสต๊อก&quot; การลบข้อมูลที่นี่จะไม่ส่งผลกระทบต่อข้อมูลเดิมที่เคยบันทึกไว้แล้ว แต่จะไม่มีชื่อนั้นให้เลือกในครั้งต่อไป
          </p>
        </div>
      </div>
    </div>
  );
}
