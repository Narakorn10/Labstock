'use client';

import React, { useState, useEffect, useRef } from 'react';
import { apiClient, Reagent } from '@/lib/api-client';
import Modal from '@/components/modal';
import { Plus, Edit2, Search, Package, AlertTriangle, Cpu, FileUp } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';

export default function MasterDataPage() {
  const { user } = useAuth();
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReagent, setEditingReagent] = useState<Partial<Reagent> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchReagents();
  }, []);

  const fetchReagents = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getDashboard();
      setReagents(data);
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const rows = text.split('\n').filter(line => line.trim());
        const header = rows[0].split(',');
        
        const items = rows.slice(1).map(row => {
          const values = row.split(',').map(s => s.trim());
          const item: any = {};
          // Map values based on expected CSV structure
          // itemId, barcode, name, reagentType, jobType, machineType, unit, minThreshold, weeklyTarget, vendor
          item.itemId = values[0];
          item.barcode = values[1];
          item.name = values[2];
          item.reagentType = values[3];
          item.jobType = values[4];
          item.machineType = values[5];
          item.unit = values[6];
          item.minThreshold = Number(values[7]) || 0;
          item.weeklyTarget = Number(values[8]) || 0;
          item.vendor = values[9] || (user?.role === 'Vendor' ? user.company : '');
          return item;
        }).filter(item => item.itemId);

        if (items.length === 0) throw new Error('ไม่พบข้อมูลที่ถูกต้องในไฟล์');

        const res = await apiClient.saveMaster({ action: 'bulk_add', items });
        alert(res.message);
        fetchReagents();
      } catch (err: any) {
        alert(err.message || 'นำเข้าข้อมูลไม่สำเร็จ');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      action: editingReagent?.itemId ? 'update' : 'add',
      itemId: formData.get('itemId'),
      qrCode: formData.get('qrCode'),
      name: formData.get('name'),
      reagentType: formData.get('reagentType'),
      jobType: formData.get('jobType'),
      machineType: formData.get('machineType'),
      unit: formData.get('unit'),
      minThreshold: Number(formData.get('minThreshold')),
      weeklyTarget: Number(formData.get('weeklyTarget')),
      vendor: formData.get('vendor'),
    };

    try {
      const res = await apiClient.saveMaster(data);
      if (res.success) {
        alert(res.message);
        setIsModalOpen(false);
        fetchReagents();
      } else {
        alert(res.message);
      }
    } catch (error: any) {
      alert(error.response?.data?.message || 'เกิดข้อผิดพลาด');
    }
  };

  const filteredReagents = reagents.filter(r => 
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.itemId.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: reagents.length,
    lowStock: reagents.filter(r => r.quantity <= r.minThreshold).length,
    machines: new Set(reagents.map(r => r.machineType)).size
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">จัดการข้อมูลพื้นฐาน (Master Data)</h1>
          <p className="text-gray-500 text-sm">จัดการรายชื่อน้ำยา, รหัสบาร์โค้ด และจุดแจ้งเตือน (Min Stock)</p>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImport} 
            accept=".csv" 
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-200 px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-all shadow-sm font-medium"
          >
            <FileUp size={20} className="text-blue-600" />
            <span className="hidden sm:inline">นำเข้า CSV</span>
          </button>
          <button 
            onClick={() => { setEditingReagent(null); setIsModalOpen(true); }}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
          >
            <Plus size={20} />
            <span className="hidden sm:inline">เพิ่มรายการใหม่</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="bg-blue-50 p-3 rounded-xl text-blue-600"><Package size={24} /></div>
          <div>
            <h3 className="font-bold text-gray-900">Reagent List</h3>
            <p className="text-xs text-gray-500">{stats.total} Items registered</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="bg-amber-50 p-3 rounded-xl text-amber-600"><AlertTriangle size={24} /></div>
          <div>
            <h3 className="font-bold text-gray-900">Low Stock</h3>
            <p className="text-xs text-gray-500">{stats.lowStock} Items below min</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="bg-purple-50 p-3 rounded-xl text-purple-600"><Cpu size={24} /></div>
          <div>
            <h3 className="font-bold text-gray-900">Machines</h3>
            <p className="text-xs text-gray-500">{stats.machines} Types configured</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="ค้นหาด้วยชื่อหรือรหัสน้ำยา..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50/50 text-gray-500 font-medium border-b border-gray-100">
              <tr>
                <th className="px-6 py-4">Item ID / Name</th>
                <th className="px-6 py-4">Type / Machine</th>
                <th className="px-6 py-4">Vendor</th>
                <th className="px-6 py-4">Min Stock</th>
                <th className="px-6 py-4">Weekly Target</th>
                <th className="px-6 py-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400">กำลังโหลดข้อมูล...</td></tr>
              ) : filteredReagents.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400">ไม่พบข้อมูล</td></tr>
              ) : filteredReagents.map((reagent) => (
                <tr key={reagent.itemId} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{reagent.itemId}</div>
                    <div className="text-xs text-gray-500">{reagent.name}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-gray-700">{reagent.reagentType}</div>
                    <div className="text-xs text-gray-400">{reagent.machineType}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs font-bold text-blue-600">{reagent.vendor || '-'}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${reagent.quantity <= reagent.minThreshold ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      Min: {reagent.minThreshold} {reagent.unit}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-700">
                    {reagent.weeklyTarget} {reagent.unit}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button 
                      onClick={() => { setEditingReagent(reagent); setIsModalOpen(true); }}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                    >
                      <Edit2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        title={editingReagent ? 'แก้ไขข้อมูลน้ำยา' : 'ลงทะเบียนน้ำยาใหม่'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Item ID</label>
              <input 
                name="itemId" 
                defaultValue={editingReagent?.itemId} 
                required 
                readOnly={!!editingReagent?.itemId}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Barcode / QR Code</label>
              <input 
                name="qrCode" 
                defaultValue={editingReagent?.qrCode} 
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase">ชื่อน้ำยา</label>
            <input 
              name="name" 
              defaultValue={editingReagent?.name} 
              required 
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">ประเภทน้ำยา</label>
              <input 
                name="reagentType" 
                defaultValue={editingReagent?.reagentType} 
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">ประเภทเครื่อง</label>
              <input 
                name="machineType" 
                defaultValue={editingReagent?.machineType} 
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">หน่วย</label>
              <input 
                name="unit" 
                defaultValue={editingReagent?.unit} 
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Min Stock</label>
              <input 
                name="minThreshold" 
                type="number" 
                defaultValue={editingReagent?.minThreshold} 
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Target/Week</label>
              <input 
                name="weeklyTarget" 
                type="number" 
                defaultValue={editingReagent?.weeklyTarget} 
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-blue-500 uppercase">บริษัทผู้ผลิต/จำหน่าย (Vendor)</label>
            <input 
              name="vendor" 
              defaultValue={user?.role === 'Vendor' ? user.company : (editingReagent?.vendor || '')} 
              readOnly={user?.role === 'Vendor'}
              placeholder="ระบุชื่อบริษัท (เช่น Roche, Abbott)"
              className={`w-full px-4 py-2 rounded-xl outline-none transition-all ${user?.role === 'Vendor' ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-blue-50/50 border border-blue-100 focus:ring-2 focus:ring-blue-500'}`}
            />
          </div>

          <div className="pt-4 flex gap-3">
            <button 
              type="button" 
              onClick={() => setIsModalOpen(false)}
              className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-all font-medium"
            >
              ยกเลิก
            </button>
            <button 
              type="submit"
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
            >
              บันทึกข้อมูล
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
