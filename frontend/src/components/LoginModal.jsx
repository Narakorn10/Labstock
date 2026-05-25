import { useState } from 'react';
import Modal from './Modal';

const LoginModal = ({ isOpen, onClose, onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        const res = await onLogin(username, password);
        setLoading(false);
        if (res.success) {
            setUsername('');
            setPassword('');
            onClose();
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="เข้าสู่ระบบ" icon="fa-lock" width="max-w-sm">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
                        <i className="fa-solid fa-user-shield text-2xl"></i>
                    </div>
                    <p className="text-sm text-slate-500 font-medium">กรุณาระบุชื่อผู้ใช้และรหัสผ่านเพื่อจัดการคลัง</p>
                </div>

                <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">ชื่อผู้ใช้</label>
                    <div className="relative">
                        <i className="fa-solid fa-user absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input 
                            autoFocus
                            type="text" 
                            required 
                            value={username} 
                            onChange={e => setUsername(e.target.value)}
                            placeholder="admin"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">รหัสผ่าน</label>
                    <div className="relative">
                        <i className="fa-solid fa-key absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input 
                            type="password" 
                            required 
                            value={password} 
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition"
                        />
                    </div>
                </div>

                <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold active-scale shadow-lg shadow-blue-100 transition mt-4 disabled:opacity-50"
                >
                    {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : "เข้าสู่ระบบ"}
                </button>

                <p className="text-[10px] text-center text-slate-400 mt-4 italic">
                    * หากไม่มีชื่อผู้ใช้ กรุณาติดต่อผู้ดูแลระบบ
                </p>
            </form>
        </Modal>
    );
};

export default LoginModal;
