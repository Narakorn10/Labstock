import { useState, useEffect } from 'react';
import useAppToast from './hooks/useAppToast';
import useGlobalData from './hooks/useGlobalData';
import useAuth from './hooks/useAuth';
import DashboardTab from './tabs/DashboardTab';
import TransactionTab from './tabs/TransactionTab';
import CountTab from './tabs/CountTab';
import MasterTab from './tabs/MasterTab';
import LogsTab from './tabs/LogsTab';
import AnalyticsTab from './tabs/AnalyticsTab';
import UsersTab from './tabs/UsersTab';
import LoginModal from './components/LoginModal';

const NavItem = ({ id, icon, label, activeTab, setActiveTab, disabled = false }) => {
    if (disabled) return null;
    const active = activeTab === id;
    return (
        <button onClick={() => setActiveTab(id)} className={`flex flex-col items-center justify-center w-full py-2 transition-all duration-200 ${active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <div className={`text-xl mb-1 ${active ? 'transform -translate-y-1 scale-110' : ''}`}><i className={`fa-solid ${icon}`}></i></div>
            <span className={`text-[9px] font-bold tracking-wide ${active ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}>{label}</span>
        </button>
    );
};

function App() {
    const { toast, showToast } = useAppToast();
    const { user, loading: authLoading, login, logout: authLogout } = useAuth(showToast);
    const { settings, activeDashboard, setActiveDashboard, loadGlobalData } = useGlobalData();
    
    const [activeTab, setActiveTab] = useState('dashboard');
    const [loginModalOpen, setLoginModalOpen] = useState(false);
    const [globalLoading, setGlobalLoading] = useState(false);
    
    const [countInputs, setCountInputs] = useState({});
    
    // 🛒 Persistent Carts Logic
    const [receiveCart, setReceiveCart] = useState(() => {
        const saved = localStorage.getItem('receive_cart');
        return saved ? JSON.parse(saved) : [];
    });
    const [dispenseCart, setDispenseCart] = useState(() => {
        const saved = localStorage.getItem('dispense_cart');
        return saved ? JSON.parse(saved) : [];
    });

    // Auto-save carts to localStorage
    useEffect(() => {
        localStorage.setItem('receive_cart', JSON.stringify(receiveCart));
    }, [receiveCart]);

    useEffect(() => {
        localStorage.setItem('dispense_cart', JSON.stringify(dispenseCart));
    }, [dispenseCart]);

    const logout = () => {
        setReceiveCart([]);
        setDispenseCart([]);
        authLogout();
    };

    const [dispensedItems, setDispensedItems] = useState(new Set());
    const [dashboardFilter, setDashboardFilter] = useState(null);

    const isUser = !!user;
    const isFullUser = user?.role === 'User' || user?.role === 'Manager' || user?.role === 'Admin';
    const isManager = user?.role === 'Manager' || user?.role === 'Admin';
    const isAdmin = user?.role === 'Admin';
    // Operator: Only Dashboard & Dispense (Role manage in Backend/Users Tab)

    const handleDispenseSuccess = (items) => {
        setDispensedItems(prev => {
            const next = new Set(prev);
            items.forEach(i => next.add(i.itemId));
            return next;
        });
        loadGlobalData();
    };

    const handleAnalyticsNavigate = (filterType) => {
        setDashboardFilter(filterType);
        setActiveTab('dashboard');
    };

    const renderTab = () => {
        if (authLoading) return <div className="flex items-center justify-center h-64 text-slate-400"><i className="fa-solid fa-circle-notch fa-spin mr-2"></i> กำลังตรวจสอบสิทธิ์...</div>;

        switch(activeTab) {
            case 'dashboard': return <DashboardTab settings={settings} showToast={showToast} activeDashboard={activeDashboard} setActiveDashboard={setActiveDashboard} externalFilter={dashboardFilter} clearExternalFilter={() => setDashboardFilter(null)} user={user} />;
            case 'analytics': 
                if (!isFullUser) { setActiveTab('dashboard'); return null; }
                return <AnalyticsTab activeDashboard={activeDashboard} onNavigate={handleAnalyticsNavigate} />;
            case 'receive': 
                if (!isFullUser) { setActiveTab('dashboard'); return null; }
                return <TransactionTab type="receive" showToast={showToast} activeDashboard={activeDashboard} cart={receiveCart} setCart={setReceiveCart} setLoading={setGlobalLoading} />;
            case 'dispense': 
                if (!isUser) { setActiveTab('dashboard'); return null; }
                return <TransactionTab type="dispense" showToast={showToast} activeDashboard={activeDashboard} cart={dispenseCart} setCart={setDispenseCart} onSuccess={handleDispenseSuccess} setLoading={setGlobalLoading} />;
            case 'count': 
                if (!isFullUser) { setActiveTab('dashboard'); return null; }
                return <CountTab settings={settings} activeDashboard={activeDashboard} inputs={countInputs} setInputs={setCountInputs} dispenseCart={dispenseCart} setDispenseCart={setDispenseCart} dispensedItems={dispensedItems} onGoToDispense={() => setActiveTab('dispense')} showToast={showToast} />;
            case 'master': 
                if (!isManager) { setActiveTab('dashboard'); return null; }
                return <MasterTab settings={settings} showToast={showToast} activeDashboard={activeDashboard} refreshDashboard={loadGlobalData} setLoading={setGlobalLoading} />;
            case 'users':
                if (!isAdmin) { setActiveTab('dashboard'); return null; }
                return <UsersTab showToast={showToast} />;
            case 'logs': 
                if (!isFullUser) { setActiveTab('dashboard'); return null; }
                return <LogsTab showToast={showToast} isAdmin={isAdmin} />;
            default: return null;
        }
    };

    return (
        <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
            {/* Desktop Topbar */}
            <header className="hidden md:flex bg-white border-b border-slate-200 sticky top-0 z-40 px-6 h-16 items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center shadow-md"><i className="fa-solid fa-layer-group"></i></div>
                    <h1 className="font-bold text-slate-800 tracking-tight text-lg">Main Stock Control</h1>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={()=>setActiveTab('dashboard')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='dashboard'?'bg-blue-50 text-blue-600':'text-slate-500 hover:bg-slate-50'}`}>แดชบอร์ด</button>
                    
                    {isFullUser && (
                        <button onClick={()=>setActiveTab('analytics')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='analytics'?'bg-indigo-50 text-indigo-600':'text-slate-500 hover:bg-slate-50'}`}>สถิติ</button>
                    )}
                    
                    {isUser && (
                        <>
                            {isFullUser && <button onClick={()=>setActiveTab('receive')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='receive'?'bg-green-50 text-green-600':'text-slate-500 hover:bg-slate-50'}`}>รับเข้า</button>}
                            {isFullUser && <button onClick={()=>setActiveTab('count')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='count'?'bg-blue-50 text-blue-600':'text-slate-500 hover:bg-slate-50'}`}>นับหน้างาน</button>}
                            <button onClick={()=>setActiveTab('dispense')} className={`relative px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='dispense'?'bg-red-50 text-red-600':'text-slate-500 hover:bg-slate-50'}`}>เบิกไปใช้ {dispenseCart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full border-2 border-white">{dispenseCart.length}</span>}</button>
                        </>
                    )}
                    
                    {isManager && <button onClick={()=>setActiveTab('master')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='master'?'bg-slate-100 text-slate-800':'text-slate-500 hover:bg-slate-50'}`}>Master</button>}
                    {isAdmin && <button onClick={()=>setActiveTab('users')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='users'?'bg-blue-100 text-blue-800':'text-slate-500 hover:bg-slate-50'}`}>จัดการผู้ใช้</button>}
                    {isFullUser && <button onClick={()=>setActiveTab('logs')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='logs'?'bg-slate-100 text-slate-800':'text-slate-500 hover:bg-slate-50'}`}>ประวัติ</button>}
                    
                    <div className="w-px h-6 bg-slate-200 mx-2"></div>
                    
                    {user ? (
                        <div className="flex items-center gap-3 ml-2">
                            <div className="text-right">
                                <div className="text-xs font-bold text-slate-800 leading-none">{user.name}</div>
                                <div className="text-[9px] text-blue-500 font-bold uppercase tracking-tighter mt-0.5">{user.role}</div>
                            </div>
                            <button onClick={logout} className="w-9 h-9 flex items-center justify-center bg-slate-100 text-slate-500 rounded-full hover:bg-red-50 hover:text-red-600 transition shadow-sm"><i className="fa-solid fa-right-from-bracket"></i></button>
                        </div>
                    ) : (
                        <button onClick={() => setLoginModalOpen(true)} className="ml-2 bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-bold active-scale transition shadow-md shadow-blue-100">เข้าสู่ระบบ</button>
                    )}
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-grow w-full max-w-6xl mx-auto p-4 md:p-6 relative">
                {renderTab()}
            </main>

            {/* Mobile Bottom Navigation */}
            <nav className="md:hidden glass-nav fixed bottom-0 w-full z-40 flex justify-around items-end pb-safe pt-1 px-2 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
                <NavItem id="dashboard" icon="fa-house" label="หน้าแรก" activeTab={activeTab} setActiveTab={setActiveTab} />
                {isFullUser && <NavItem id="analytics" icon="fa-chart-pie" label="สถิติ" activeTab={activeTab} setActiveTab={setActiveTab} />}
                {isFullUser && <NavItem id="receive" icon="fa-box-open" label="รับเข้า" activeTab={activeTab} setActiveTab={setActiveTab} disabled={!isUser} />}
                {isFullUser && <NavItem id="count" icon="fa-clipboard-check" label="นับหน้างาน" activeTab={activeTab} setActiveTab={setActiveTab} disabled={!isUser} />}
                <div className="relative w-full">
                    <NavItem id="dispense" icon="fa-hand-holding-droplet" label="เบิกจ่าย" activeTab={activeTab} setActiveTab={setActiveTab} disabled={!isUser} />
                    {isUser && dispenseCart.length > 0 && <span className="absolute top-1 right-2 bg-red-500 text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-full">{dispenseCart.length}</span>}
                </div>
                {isManager && <NavItem id="master" icon="fa-database" label="ข้อมูล" activeTab={activeTab} setActiveTab={setActiveTab} disabled={!isManager} />}
                {isFullUser && <NavItem id="logs" icon="fa-clock-rotate-left" label="ประวัติ" activeTab={activeTab} setActiveTab={setActiveTab} disabled={!isUser} />}
                
                {!user && (
                    <button onClick={() => setLoginModalOpen(true)} className="flex flex-col items-center justify-center w-full py-2 text-slate-400">
                        <div className="text-xl mb-1"><i className="fa-solid fa-lock"></i></div>
                        <span className="text-[9px] font-bold uppercase">Login</span>
                    </button>
                )}
            </nav>

            {/* Login Modal */}
            <LoginModal isOpen={loginModalOpen} onClose={() => setLoginModalOpen(false)} onLogin={login} />

            {/* Global Loading Overlay */}
            {globalLoading && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] animate-fade-in">
                    <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4 animate-scale-in">
                        <div className="relative">
                            <div className="w-16 h-16 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center text-blue-600">
                                <i className="fa-solid fa-cloud-arrow-up animate-pulse"></i>
                            </div>
                        </div>
                        <div className="text-center">
                            <h3 className="font-bold text-slate-800">กำลังบันทึกข้อมูล</h3>
                            <p className="text-xs text-slate-400 mt-1">กรุณารอสักครู่ ระบบกำลังประมวลผล...</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notification */}
            <div className={`fixed top-4 md:top-auto md:bottom-20 left-1/2 transform -translate-x-1/2 md:translate-x-0 md:left-auto md:right-6 bg-slate-800 text-white px-5 py-3 rounded-full shadow-2xl transition duration-300 z-50 flex items-center gap-3 ${toast.show ? 'translate-y-0 opacity-100' : '-translate-y-20 md:translate-y-20 opacity-0'}`}>
                <i className={`fa-solid ${toast.type === 'success' ? 'fa-circle-check text-green-400' : 'fa-circle-exclamation text-amber-400'}`}></i>
                <span className="text-sm font-medium">{toast.msg}</span>
            </div>
        </div>
    );
}

export default App;
