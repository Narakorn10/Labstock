'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient, User as ApiUser } from '@/lib/api-client';
import Modal from '@/components/modal';
import { useAuth } from '@/components/auth-provider';
import {
  UserPlus, 
  Trash2, 
  Loader2, 
  CheckCircle, 
  XCircle,
  X,
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
  const [departments, setDepartments] = useState<string[]>([]);
  const [legacyDepartment, setLegacyDepartment] = useState('');
  
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
      try {
        const settings = await apiClient.getSettings();
        if (isMounted) setDepartments(settings.departments ?? []);
      } catch (e) {
        console.error(e);
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
    setLegacyDepartment('');
    setForm({ username: '', password: '', name: '', role: 'User', vendor: '', department: '', pin: '' });
    setModalOpen(true);
  };

  const openEditModal = (user: ApiUser) => {
    setIsEdit(true);
    // When a department list exists in Settings, a saved value that is not on it must be re-picked.
    const currentDepartment = user.department || '';
    const needsRepick = user.role !== 'Vendor' && departments.length > 0 && !!currentDepartment && !departments.includes(currentDepartment);
    setLegacyDepartment(needsRepick ? currentDepartment : '');
    setForm({ 
      username: user.username, 
      password: '', 
      name: user.name, 
      role: user.role,
      vendor: user.vendor || '',
      department: needsRepick ? '' : currentDepartment,
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
        <p className="mt-1 text-sm text-ink-muted">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
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

  const statusTabs: Array<[typeof statusFilter, string, number]> = [
    ['all', 'ทั้งหมด', userSummary.total],
    ['active', 'ใช้งาน', userSummary.active],
    ['pending', 'รออนุมัติ', userSummary.pending],
    ['suspended', 'ระงับ', userSummary.suspended],
  ];
  const statusTag: Record<string, string> = {
    active: 'bg-ok-bg text-ok',
    pending: 'bg-warn-bg text-warn',
    suspended: 'bg-crit-bg text-crit',
  };
  const statusLabel: Record<string, string> = { active: 'ใช้งาน', pending: 'รออนุมัติ', suspended: 'ระงับ' };
  const fieldClass = 'min-h-[38px] w-full rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10';
  const labelClass = 'flex flex-col gap-1.5 text-[13px] text-gray-600';
  const cellClass = 'border-b border-line px-3.5 py-3 align-middle text-sm';
  const headClass = 'bg-ground px-3.5 py-2.5 text-left text-[13px] font-medium text-gray-600';
  const iconBtnClass = 'inline-flex rounded-[10px] p-2 transition disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[32px] leading-tight font-medium text-ink">จัดการผู้ใช้งาน</h1>
          <p className="mt-1.5 text-[15px] text-gray-600">กำหนดบทบาทและหน่วยงาน สิทธิ์เมนูของแต่ละบทบาทตั้งค่าที่ Permissions (RBAC)</p>
        </div>
        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex items-center gap-2 rounded-[10px] border border-ink bg-ink px-4 py-[9px] text-sm font-medium text-white transition hover:bg-black active:scale-[0.99]"
        >
          <UserPlus size={16} />
          เพิ่มผู้ใช้ใหม่
        </button>
      </div>

      {feedback && (
        <div role="status" className={`flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium ${feedback.type === 'success' ? 'bg-ok-bg text-ok' : 'bg-crit-bg text-crit'}`}>
          <span className="flex-1">{feedback.msg}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="ปิดข้อความ" className="opacity-70 hover:opacity-100"><X size={16} /></button>
        </div>
      )}

      <section aria-label="รายชื่อผู้ใช้งาน" className="rounded-2xl border border-line bg-white p-5">
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
          <div role="group" aria-label="กรองตามสถานะ" className="mr-auto flex flex-wrap gap-1.5">
            {statusTabs.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                aria-pressed={statusFilter === key}
                onClick={() => setStatusFilter(key)}
                className={`inline-flex items-center gap-2 rounded-[10px] border px-3 py-1.5 text-[13px] font-medium transition ${statusFilter === key ? 'border-ink bg-ink text-white' : 'border-line bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                {label} <span className="opacity-60">{count}</span>
              </button>
            ))}
          </div>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">ค้นหาผู้ใช้</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อ, username, อีเมล หรือบริษัท" className={`${fieldClass} pl-9`} />
          </label>
          <select aria-label="กรองตามบทบาท" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className={`${fieldClass} !w-auto cursor-pointer`}>
            <option value="all">ทุก Role</option>
            <option value="Admin">Admin</option>
            <option value="Manager">Manager</option>
            <option value="Operator">Operator</option>
            <option value="User">User</option>
            <option value="Vendor">Vendor</option>
          </select>
          <button type="button" onClick={() => void loadUsers()} disabled={loading} className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink transition hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left">
            <caption className="sr-only">รายชื่อผู้ใช้งานระบบ</caption>
            <thead>
              <tr>
                <th scope="col" className={`${headClass} rounded-l-[10px]`}>ผู้ใช้งาน</th>
                <th scope="col" className={headClass}>หน่วยงาน</th>
                <th scope="col" className={`${headClass} w-[140px]`}>บทบาท</th>
                <th scope="col" className={`${headClass} w-[120px]`}>สถานะ</th>
                <th scope="col" className={`${headClass} rounded-r-[10px] text-right`}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map(u => (
                <tr key={u.username} className={u.accountStatus === 'suspended' ? 'opacity-60' : ''}>
                  <td className={cellClass}>
                    <div className="flex items-center gap-2.5">
                      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-gray-200 text-[13px] font-semibold">{(u.name || u.username).charAt(0)}</span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.name}</div>
                        <div className="truncate text-xs text-gray-600">@{u.username}{u.email ? ` · ${u.email}` : ''}</div>
                        {u.vendorRequest && <div className="truncate text-xs text-warn">ขอเพิ่มบริษัท: {u.vendorRequest}</div>}
                      </div>
                    </div>
                  </td>
                  <td className={cellClass}>
                    {u.role === 'Vendor' || u.vendor ? (u.vendor || '-') : (u.department || '-')}
                  </td>
                  <td className={cellClass}>
                    <span className="inline-flex items-center rounded-full bg-gray-200 px-2.5 py-[3px] text-xs font-medium">{u.role}</span>
                    <div className="mt-1 text-[11px] text-gray-600">{u.hasPin ? 'PIN พร้อมใช้' : 'ยังไม่มี PIN'}</div>
                  </td>
                  <td className={cellClass}>
                    {u.accountStatus ? (
                      <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-medium ${statusTag[u.accountStatus] || 'bg-gray-200'}`}>
                        {statusLabel[u.accountStatus] || u.accountStatus}
                      </span>
                    ) : '-'}
                  </td>
                  <td className={`${cellClass} text-right`}>
                    <div className="inline-flex items-center gap-0.5">
                      {u.accountStatus === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleAccountStatus(u, 'active')}
                            disabled={submitting}
                            className={`${iconBtnClass} text-ok hover:bg-ok-bg`}
                            title="อนุมัติบัญชี"
                            aria-label={`อนุมัติบัญชี ${u.username}`}
                          >
                            <CheckCircle size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAccountStatus(u, 'suspended')}
                            disabled={submitting}
                            className={`${iconBtnClass} text-crit hover:bg-crit-bg`}
                            title="ไม่อนุมัติบัญชี"
                            aria-label={`ไม่อนุมัติบัญชี ${u.username}`}
                          >
                            <XCircle size={18} />
                          </button>
                        </>
                      )}
                      {u.accountStatus === 'active' && u.username !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => handleAccountStatus(u, 'suspended')}
                          disabled={submitting}
                          className={`${iconBtnClass} text-warn hover:bg-warn-bg`}
                          title="ระงับบัญชี"
                          aria-label={`ระงับบัญชี ${u.username}`}
                        >
                          <XCircle size={18} />
                        </button>
                      )}
                      {u.accountStatus === 'suspended' && (
                        <button
                          type="button"
                          onClick={() => handleAccountStatus(u, 'active')}
                          disabled={submitting}
                          className={`${iconBtnClass} text-ok hover:bg-ok-bg`}
                          title="เปิดใช้งานบัญชีอีกครั้ง"
                          aria-label={`เปิดใช้งานบัญชี ${u.username} อีกครั้ง`}
                        >
                          <CheckCircle size={18} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        className={`${iconBtnClass} text-gray-700 hover:bg-gray-100`}
                        title="แก้ไขข้อมูล/รหัสผ่าน"
                        aria-label={`แก้ไข ${u.username}`}
                      >
                        <Pencil size={18} />
                      </button>
                      {u.username !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u.username)}
                          className={`${iconBtnClass} text-gray-700 hover:bg-crit-bg hover:text-crit`}
                          title="ลบผู้ใช้"
                          aria-label={`ลบ ${u.username}`}
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleUsers.length === 0 && !loading && (
          <div className="mt-3 rounded-xl border-[1.5px] border-dashed border-line px-3.5 py-12">
            <p className="text-[17px] font-medium">{users.length === 0 ? 'ไม่พบข้อมูลผู้ใช้งาน' : 'ไม่พบผู้ใช้ตามตัวกรอง'}</p>
          </div>
        )}
      </section>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={isEdit ? "แก้ไขข้อมูลผู้ใช้งาน" : "เพิ่มผู้ใช้งานใหม่"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className={labelClass}>
            ชื่อ-นามสกุล
            <input
              type="text" required
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              placeholder="เช่น สมชาย ใจดี"
              className={fieldClass}
            />
          </label>

          {form.role !== 'Vendor' && (
            <label className={labelClass}>
              หน่วยงาน (Department)
              {departments.length > 0 ? (
                <select
                  required
                  value={form.department || ''}
                  onChange={e => setForm({ ...form, department: e.target.value })}
                  className={`${fieldClass} cursor-pointer`}
                >
                  <option value="">— เลือกหน่วยงาน —</option>
                  {departments.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  maxLength={160}
                  value={form.department || ''}
                  onChange={e => setForm({ ...form, department: e.target.value })}
                  placeholder="เช่น ห้องปฏิบัติการเคมีคลินิก"
                  className={fieldClass}
                />
              )}
              {legacyDepartment && (
                <span role="status" className="text-xs font-medium text-warn">หน่วยงานเดิม “{legacyDepartment}” ไม่อยู่ในรายการตั้งค่า กรุณาเลือกใหม่</span>
              )}
              <span className="text-xs text-gray-600">
                {departments.length > 0 ? 'รายการมาจากหน้าตั้งค่าระบบ (Settings) · ' : 'ยังไม่มีรายการหน่วยงานใน Settings จึงพิมพ์เองได้ · '}
                ใช้เป็นหัวกระดาษของใบสั่งของ (PO) ที่ผู้ใช้นี้สร้าง
              </span>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Username
              <input
                type="text" required
                disabled={isEdit}
                value={form.username}
                onChange={e => setForm({...form, username: e.target.value})}
                placeholder="ภาษาอังกฤษ"
                className={`${fieldClass} ${isEdit ? 'cursor-not-allowed bg-ground opacity-70' : ''}`}
              />
            </label>
            <label className={labelClass}>
              {isEdit ? "Password (เว้นว่างถ้าไม่เปลี่ยน)" : "Password"}
              <input
                type="password"
                required={!isEdit}
                value={form.password}
                onChange={e => setForm({...form, password: e.target.value})}
                placeholder="••••••••"
                className={fieldClass}
              />
            </label>
          </div>

          <label className={labelClass}>
            {isEdit ? "PIN (leave blank to keep current)" : "User PIN"}
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.pin || ''}
              onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              placeholder="4-6 digits for mobile confirm"
              className={fieldClass}
            />
            <span className="text-xs text-gray-600">Used by the no-login mobile receive/dispense confirm step.</span>
          </label>

          <label className={labelClass}>
            สิทธิ์การใช้งาน (Role)
            <select
              value={form.role}
              onChange={e => setForm({...form, role: e.target.value})}
              className={`${fieldClass} cursor-pointer`}
            >
              <option value="User">User (เบิก/รับ/นับ/ประวัติ)</option>
              <option value="Operator">Operator (เบิกจ่าย + แดชบอร์ด)</option>
              <option value="Manager">Manager (จัดการน้ำยา + รายการ)</option>
              <option value="Admin">Admin (จัดการผู้ใช้ + ทุกอย่าง)</option>
              <option value="Vendor">Vendor (ผู้แทนบริษัท - ดูเฉพาะของตนเอง)</option>
            </select>
          </label>

          {(form.role === 'Vendor' || form.vendor) && (
            <label className={labelClass}>
              สังกัดบริษัท (Vendor)
              <input
                type="text"
                required={form.role === 'Vendor'}
                value={form.vendor}
                onChange={e => setForm({...form, vendor: e.target.value})}
                placeholder="ระบุชื่อบริษัทให้ตรงกับในฐานข้อมูล"
                className={fieldClass}
              />
            </label>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-ink bg-ink px-5 py-3 text-sm font-medium text-white transition hover:bg-black active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}
            {isEdit ? "บันทึกการแก้ไข" : "สร้างบัญชีผู้ใช้"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
