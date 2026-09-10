'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient, User as ApiUser } from '@/lib/api-client';
import Modal from '@/components/modal';
import { useAuth } from '@/components/auth-provider';
import { 
  UserPlus, 
  User, 
  Trash2, 
  Loader2, 
  CheckCircle, 
  XCircle,
  ChevronDown,
  Pencil,
  Search,
  RefreshCw,
} from 'lucide-react';

export default function UsersPage() {
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'suspended'>('all');
  const [roleFilter, setRoleFilter] = useState('all');
  
  const [form, setForm] = useState<ApiUser>({ 
    username: '', 
    password: '', 
    name: '', 
    role: 'User',
    vendor: '',
    pin: ''
  });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.getUsers();
      setUsers(data);
    } catch (e) {
      console.error(e);
      const error = e as { response?: { data?: { error?: string } } };
      setFeedback({ type: 'error', msg: error.response?.data?.error || 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || user.role !== 'Admin') return;
    let isMounted = true;
    const load = async () => {
      if (isMounted) {
        await loadUsers();
      }
    };
    load();
    return () => { isMounted = false; };
  }, [authLoading, loadUsers, user]);

  const visibleUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return users.filter((candidate) => {
      const matchesSearch = !keyword
        || candidate.username.toLowerCase().includes(keyword)
        || candidate.name.toLowerCase().includes(keyword)
        || String(candidate.email || '').toLowerCase().includes(keyword)
        || String(candidate.vendor || '').toLowerCase().includes(keyword);
      const matchesStatus = statusFilter === 'all' || (candidate.accountStatus || 'active') === statusFilter;
      const matchesRole = roleFilter === 'all' || candidate.role === roleFilter;
      return matchesSearch && matchesStatus && matchesRole;
    });
  }, [roleFilter, search, statusFilter, users]);

  const userSummary = useMemo(() => ({
    total: users.length,
    active: users.filter((candidate) => (candidate.accountStatus || 'active') === 'active').length,
    pending: users.filter((candidate) => candidate.accountStatus === 'pending').length,
    suspended: users.filter((candidate) => candidate.accountStatus === 'suspended').length,
  }), [users]);

  const openAddModal = () => {
    setIsEdit(false);
    setForm({ username: '', password: '', name: '', role: 'User', vendor: '', pin: '' });
    setModalOpen(true);
  };

  const openEditModal = (user: ApiUser) => {
    setIsEdit(true);
    setForm({ 
      username: user.username, 
      password: '', 
      name: user.name, 
      role: user.role,
      vendor: user.vendor || '',
      pin: ''
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isEdit) {
        await apiClient.updateUser(form.username, form);
        setFeedback({ type: 'success', msg: 'อัปเดตข้อมูลผู้ใช้สำเร็จ' });
      } else {
        await apiClient.addUser(form);
        setFeedback({ type: 'success', msg: 'เพิ่มผู้ใช้สำเร็จ' });
      }
      setModalOpen(false);
      loadUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setFeedback({ type: 'error', msg: error.response?.data?.error || 'เกิดข้อผิดพลาด' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (username === 'admin') return;
    if (!confirm(`ยืนยันการลบผู้ใช้ "${username}"?`)) return;

    try {
      await apiClient.deleteUser(username);
      setFeedback({ type: 'success', msg: 'ลบผู้ใช้สำเร็จ' });
      loadUsers();
    } catch {
      setFeedback({ type: 'error', msg: 'ลบไม่สำเร็จ' });
    }
  };

  const handleAccountStatus = async (user: ApiUser, accountStatus: 'active' | 'suspended') => {
    const action = accountStatus === 'active' ? 'อนุมัติ' : 'ระงับ';
    if (!confirm(`ยืนยันการ${action}บัญชี "${user.username}"?`)) return;

    setSubmitting(true);
    try {
      await apiClient.updateUserAccountStatus(user.username, accountStatus);
      setFeedback({ type: 'success', msg: `${action}บัญชี ${user.username} สำเร็จ` });
      await loadUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setFeedback({ type: 'error', msg: error.response?.data?.error || `ไม่สามารถ${action}บัญชีได้` });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-blue-600" size={48} />
      </div>
    );
  }

  if (!user || user.role !== 'Admin') {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <XCircle className="mx-auto mb-4 text-red-500" size={48} />
        <h1 className="text-xl font-black text-gray-900">ไม่มีสิทธิ์จัดการผู้ใช้งาน</h1>
        <p className="mt-2 text-sm text-gray-500">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
      </div>
    );
  }

  if (loading && users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-blue-600" size={48} />
        <p className="text-gray-500 animate-pulse font-black text-xs uppercase tracking-widest">กำลังโหลดรายชื่อผู้ใช้...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">จัดการผู้ใช้งาน</h1>
          <p className="text-gray-500 text-sm font-bold">เพิ่มหรือลบบัญชีรายชื่อผู้มีสิทธิ์ใช้งานระบบ</p>
        </div>
        <button 
          onClick={openAddModal}
          className="flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95"
        >
          <UserPlus size={18} />
          เพิ่มผู้ใช้ใหม่
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['ทั้งหมด', userSummary.total, 'bg-slate-50 text-slate-700'],
          ['ใช้งาน', userSummary.active, 'bg-emerald-50 text-emerald-700'],
          ['รออนุมัติ', userSummary.pending, 'bg-amber-50 text-amber-700'],
          ['ระงับ', userSummary.suspended, 'bg-rose-50 text-rose-700'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className={`rounded-2xl border border-gray-100 p-4 shadow-sm ${color}`}>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
            <p className="mt-1 text-2xl font-black">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อ, username, อีเมล หรือบริษัท" className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10" />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-blue-500">
          <option value="all">ทุกสถานะ</option>
          <option value="active">ใช้งาน</option>
          <option value="pending">รออนุมัติ</option>
          <option value="suspended">ระงับ</option>
        </select>
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-blue-500">
          <option value="all">ทุก Role</option>
          <option value="Admin">Admin</option>
          <option value="Manager">Manager</option>
          <option value="Operator">Operator</option>
          <option value="User">User</option>
          <option value="Vendor">Vendor</option>
        </select>
        <button type="button" onClick={() => void loadUsers()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> รีเฟรช
        </button>
      </div>

      {feedback && (
        <div className={`p-4 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 ${
          feedback.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={20} /> : <XCircle size={20} />}
          <p className="text-sm font-bold flex-1">{feedback.msg}</p>
          <button onClick={() => setFeedback(null)} className="text-xs font-black uppercase">ปิด</button>
        </div>
      )}

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleUsers.map(u => (
          <div key={u.username} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow group">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 bg-gray-50 text-gray-400 rounded-2xl flex items-center justify-center group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors shrink-0">
                <User size={28} />
              </div>
              <div className="min-w-0">
                <p className="font-black text-gray-900 truncate">{u.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">@{u.username}</span>
                  <span className={`
                    text-[9px] font-black uppercase px-2 py-0.5 rounded-full
                    ${u.role === 'Admin' ? 'bg-red-50 text-red-600' : u.role === 'Manager' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}
                  `}>
                    {u.role}
                  </span>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${u.hasPin ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                    {u.hasPin ? 'PIN Ready' : 'No PIN'}
                  </span>
                  {u.accountStatus && (
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                      u.accountStatus === 'active'
                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                        : u.accountStatus === 'pending'
                          ? 'bg-amber-50 text-amber-700 border-amber-100'
                          : 'bg-red-50 text-red-600 border-red-100'
                    }`}>
                      {u.accountStatus === 'active' ? 'ใช้งาน' : u.accountStatus === 'pending' ? 'รออนุมัติ' : 'ระงับ'}
                    </span>
                  )}
                  {u.vendor && (
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                        {u.vendor}
                    </span>
                  )}
                </div>
                {u.email && <p className="mt-1 text-[10px] font-medium text-gray-400 truncate">{u.email}</p>}
                {u.vendorRequest && <p className="mt-1 text-[10px] font-medium text-amber-600 truncate">ขอเพิ่มบริษัท: {u.vendorRequest}</p>}
              </div>
            </div>
            
            <div className="flex items-center gap-1">
              {u.accountStatus === 'pending' && (
                <>
                  <button
                    onClick={() => handleAccountStatus(u, 'active')}
                    disabled={submitting}
                    className="p-3 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all active:scale-90 disabled:opacity-50"
                    title="อนุมัติบัญชี"
                  >
                    <CheckCircle size={18} />
                  </button>
                  <button
                    onClick={() => handleAccountStatus(u, 'suspended')}
                    disabled={submitting}
                    className="p-3 text-red-600 hover:bg-red-50 rounded-xl transition-all active:scale-90 disabled:opacity-50"
                    title="ไม่อนุมัติบัญชี"
                  >
                    <XCircle size={18} />
                  </button>
                </>
              )}
              {u.accountStatus === 'active' && u.username !== 'admin' && (
                <button
                  onClick={() => handleAccountStatus(u, 'suspended')}
                  disabled={submitting}
                  className="p-3 text-amber-600 hover:bg-amber-50 rounded-xl transition-all active:scale-90 disabled:opacity-50"
                  title="ระงับบัญชี"
                >
                  <XCircle size={18} />
                </button>
              )}
              {u.accountStatus === 'suspended' && (
                <button
                  onClick={() => handleAccountStatus(u, 'active')}
                  disabled={submitting}
                  className="p-3 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all active:scale-90 disabled:opacity-50"
                  title="เปิดใช้งานบัญชีอีกครั้ง"
                >
                  <CheckCircle size={18} />
                </button>
              )}
              <button 
                onClick={() => openEditModal(u)}
                className="p-3 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all active:scale-90"
                title="แก้ไขข้อมูล/รหัสผ่าน"
              >
                <Pencil size={18} />
              </button>
              {u.username !== 'admin' && (
                <button 
                  onClick={() => handleDeleteUser(u.username)}
                  className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-90"
                  title="ลบผู้ใช้"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>
        ))}

        {visibleUsers.length === 0 && !loading && (
          <div className="col-span-full py-20 text-center text-gray-300">
            <User size={64} className="mx-auto mb-4 opacity-20" />
            <p className="font-bold uppercase tracking-widest">{users.length === 0 ? 'ไม่พบข้อมูลผู้ใช้งาน' : 'ไม่พบผู้ใช้ตามตัวกรอง'}</p>
          </div>
        )}
      </div>

      <Modal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        title={isEdit ? "แก้ไขข้อมูลผู้ใช้งาน" : "เพิ่มผู้ใช้งานใหม่"}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">ชื่อ-นามสกุล</label>
            <input 
              type="text" required
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              placeholder="เช่น สมชาย ใจดี"
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Username</label>
              <input 
                type="text" required
                disabled={isEdit}
                value={form.username}
                onChange={e => setForm({...form, username: e.target.value})}
                placeholder="ภาษาอังกฤษ"
                className={`w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none transition-all ${isEdit ? 'opacity-50 cursor-not-allowed' : 'focus:ring-2 focus:ring-blue-500'}`}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                {isEdit ? "Password (เว้นว่างถ้าไม่เปลี่ยน)" : "Password"}
              </label>
              <input 
                type="password" 
                required={!isEdit}
                value={form.password}
                onChange={e => setForm({...form, password: e.target.value})}
                placeholder="••••••••"
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
              {isEdit ? "PIN (leave blank to keep current)" : "User PIN"}
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.pin || ''}
              onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              placeholder="4-6 digits for mobile confirm"
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
            <p className="text-xs font-medium text-gray-500">Used by the no-login mobile receive/dispense confirm step.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">สิทธิ์การใช้งาน (Role)</label>
            <div className="relative">
              <select 
                value={form.role}
                onChange={e => setForm({...form, role: e.target.value})}
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold appearance-none focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              >
                <option value="User">User (เบิก/รับ/นับ/ประวัติ)</option>
                <option value="Operator">Operator (เบิกจ่าย + แดชบอร์ด)</option>
                <option value="Manager">Manager (จัดการน้ำยา + รายการ)</option>
                <option value="Admin">Admin (จัดการผู้ใช้ + ทุกอย่าง)</option>
                <option value="Vendor">Vendor (ผู้แทนบริษัท - ดูเฉพาะของตนเอง)</option>
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
            </div>
          </div>

          {(form.role === 'Vendor' || form.vendor) && (
            <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-300">
                <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest ml-1">สังกัดบริษัท (Vendor)</label>
                <input 
                type="text" 
                required={form.role === 'Vendor'}
                value={form.vendor}
                onChange={e => setForm({...form, vendor: e.target.value})}
                placeholder="ระบุชื่อบริษัทให้ตรงกับในฐานข้อมูล"
                className="w-full p-4 bg-blue-50/50 border border-blue-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
            </div>
          )}

          <button 
            type="submit"
            disabled={submitting}
            className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg hover:bg-gray-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
            {isEdit ? "บันทึกการแก้ไข" : "สร้างบัญชีผู้ใช้"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
