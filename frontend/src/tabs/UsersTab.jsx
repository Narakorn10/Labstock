import { useState, useEffect } from 'react';
import { gasRun } from '../api';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import { SkeletonRow } from '../components/Skeleton';

const UsersTab = ({ showToast }) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState({ username: '', password: '', name: '', role: 'User' });
    const [submitting, setLoadingSubmit] = useState(false);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const res = await gasRun('getUsers');
            setUsers(res);
        } catch (e) {
            showToast("ไม่สามารถดึงข้อมูลผู้ใช้ได้", "error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const handleAddUser = async (e) => {
        e.preventDefault();
        setLoadingSubmit(true);
        try {
            const res = await gasRun('addUser', form);
            showToast(res.message, res.success ? 'success' : 'error');
            if (res.success) {
                setModalOpen(false);
                setForm({ username: '', password: '', name: '', role: 'User' });
                loadUsers();
            }
        } catch (e) {
            showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", "error");
        } finally {
            setLoadingSubmit(false);
        }
    };

    const handleDeleteUser = async (username) => {
        if (username === 'admin') return showToast("ไม่สามารถลบ Admin หลักได้", "error");
        if (!confirm(`ยืนยันการลบผู้ใช้ "${username}"?`)) return;

        showToast("กำลังลบ...");
        try {
            const res = await gasRun('deleteUser', username);
            showToast(res.message, res.success ? 'success' : 'error');
            if (res.success) loadUsers();
        } catch (e) {
            showToast("เกิดข้อผิดพลาด", "error");
        }
    };

    return (
        <div className="space-y-4 sm:space-y-6 animate-slide-up pb-24">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">จัดการผู้ใช้งาน</h2>
                    <p className="text-xs text-slate-500 mt-1">เพิ่มหรือลบบัญชีรายชื่อผู้มีสิทธิ์ใช้งานระบบ</p>
                </div>
                <button 
                    onClick={() => setModalOpen(true)} 
                    className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold active-scale transition shadow-md shadow-blue-100 flex items-center justify-center gap-2"
                >
                    <i className="fa-solid fa-user-plus"></i> เพิ่มผู้ใช้ใหม่
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {loading ? Array(4).fill(0).map((_, i) => <SkeletonRow key={i} />) : 
                 users.length === 0 ? (
                    <div className="col-span-full text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-100">
                        <i className="fa-solid fa-users-slash text-4xl mb-4 opacity-20"></i>
                        <p>ยังไม่มีข้อมูลผู้ใช้งาน</p>
                    </div>
                 ) :
                 users.map(u => (
                    <div key={u.username} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center hover:border-blue-200 transition group">
                        <div className="flex items-center gap-4 overflow-hidden">
                            <div className="w-12 h-12 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center flex-shrink-0 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                                <i className="fa-solid fa-user text-xl"></i>
                            </div>
                            <div className="overflow-hidden">
                                <div className="font-bold text-slate-800 truncate">{u.name}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-slate-400 font-mono">@{u.username}</span>
                                    <Badge color={u.role === 'Admin' ? 'red' : u.role === 'Manager' ? 'purple' : 'blue'}>{u.role}</Badge>
                                </div>
                            </div>
                        </div>
                        {u.username !== 'admin' && (
                            <button 
                                onClick={() => handleDeleteUser(u.username)} 
                                className="w-9 h-9 flex items-center justify-center bg-slate-50 text-slate-400 rounded-lg hover:bg-red-50 hover:text-red-500 transition-colors active-scale"
                            >
                                <i className="fa-solid fa-trash-can text-sm"></i>
                            </button>
                        )}
                    </div>
                ))}
            </div>

            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="เพิ่มผู้ใช้งานใหม่" icon="fa-user-plus">
                <form onSubmit={handleAddUser} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase ml-1">ชื่อ-นามสกุล</label>
                        <input 
                            type="text" required value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                            placeholder="เช่น สมชาย ใจดี"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase ml-1">Username</label>
                            <input 
                                type="text" required value={form.username} onChange={e => setForm({...form, username: e.target.value})}
                                placeholder="ภาษาอังกฤษ"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase ml-1">Password</label>
                            <input 
                                type="password" required value={form.password} onChange={e => setForm({...form, password: e.target.value})}
                                placeholder="••••••••"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase ml-1">สิทธิ์การใช้งาน (Role)</label>
                        <select 
                            value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                            <option value="User">User (เบิก/รับ/นับ/ประวัติ)</option>
                            <option value="Operator">Operator (เฉพาะเบิกจ่าย + แดชบอร์ด)</option>
                            <option value="Manager">Manager (จัดการน้ำยา + รายการ)</option>
                            <option value="Admin">Admin (จัดการผู้ใช้ + ทุกอย่าง)</option>
                        </select>
                    </div>
                    <button 
                        type="submit" disabled={submitting}
                        className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold active-scale shadow-lg shadow-slate-200 mt-4 disabled:opacity-50"
                    >
                        {submitting ? <i className="fa-solid fa-circle-notch fa-spin"></i> : "สร้างบัญชีผู้ใช้"}
                    </button>
                </form>
            </Modal>
        </div>
    );
};

export default UsersTab;
