import React, { useState } from 'react';
import useAppToast from './hooks/useAppToast';
import useGlobalData from './hooks/useGlobalData';
import DashboardTab from './tabs/DashboardTab';
import TransactionTab from './tabs/TransactionTab';
import CountTab from './tabs/CountTab';
import MasterTab from './tabs/MasterTab';
import LogsTab from './tabs/LogsTab';

const NavItem = ({ id, icon, label, activeTab, setActiveTab }) => {
    const active = activeTab === id;
    return (
        <button onClick={() => setActiveTab(id)} className={`flex flex-col items-center justify-center w-full py-2 transition-all duration-200 ${active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <div className={`text-xl mb-1 ${active ? 'transform -translate-y-1 scale-110' : ''}`}><i className={`fa-solid ${icon}`}></i></div>
            <span className={`text-[9px] font-bold tracking-wide ${active ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}>{label}</span>
        </button>
    );
};

function App() {
    const [activeTab, setActiveTab] = useState('dashboard');
    const { toast, showToast } = useAppToast();
    const { settings, activeDashboard, setActiveDashboard, loadGlobalData } = useGlobalData();
    
    const [dispensePrep, setDispensePrep] = useState(null);
    const [countInputs, setCountInputs] = useState({});

    const renderTab = () => {
        switch(activeTab) {
            case 'dashboard': return <DashboardTab settings={settings} showToast={showToast} activeDashboard={activeDashboard} setActiveDashboard={setActiveDashboard} />;
            case 'receive': return <TransactionTab type="receive" showToast={showToast} activeDashboard={activeDashboard} />;
            case 'dispense': return <TransactionTab type="dispense" showToast={showToast} dispensePrepData={dispensePrep} clearPrepData={()=>setDispensePrep(null)} activeDashboard={activeDashboard} />;
            case 'count': return <CountTab settings={settings} activeDashboard={activeDashboard} onJumpToDispense={(qr, q)=> { setDispensePrep({ qrCode: qr, qty: q }); setActiveTab('dispense'); }} inputs={countInputs} setInputs={setCountInputs} />;
            case 'master': return <MasterTab settings={settings} showToast={showToast} activeDashboard={activeDashboard} refreshDashboard={loadGlobalData} />;
            case 'logs': return <LogsTab showToast={showToast} />;
            default: return null;
        }
    };

    return (
        <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
            {/* Desktop Topbar */}
            <header className="hidden md:flex bg-white border-b border-slate-200 sticky top-0 z-40 px-6 h-16 items-center justify-between shadow-sm">
                <div className="flex items-center gap-3"><div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center shadow-md"><i className="fa-solid fa-layer-group"></i></div><h1 className="font-bold text-slate-800 tracking-tight text-lg">Main Stock Control</h1></div>
                <div className="flex gap-1">
                    <button onClick={()=>setActiveTab('dashboard')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='dashboard'?'bg-blue-50 text-blue-600':'text-slate-500 hover:bg-slate-50'}`}>แดชบอร์ด</button>
                    <button onClick={()=>setActiveTab('receive')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='receive'?'bg-green-50 text-green-600':'text-slate-500 hover:bg-slate-50'}`}>รับเข้า</button>
                    <button onClick={()=>setActiveTab('count')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='count'?'bg-blue-50 text-blue-600':'text-slate-500 hover:bg-slate-50'}`}>นับหน้างาน</button>
                    <button onClick={()=>setActiveTab('dispense')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='dispense'?'bg-red-50 text-red-600':'text-slate-500 hover:bg-slate-50'}`}>เบิกไปใช้</button>
                    <button onClick={()=>setActiveTab('master')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='master'?'bg-slate-100 text-slate-800':'text-slate-500 hover:bg-slate-50'}`}>Master</button>
                    <button onClick={()=>setActiveTab('logs')} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab==='logs'?'bg-slate-100 text-slate-800':'text-slate-500 hover:bg-slate-50'}`}>ประวัติ</button>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-grow w-full max-w-6xl mx-auto p-4 md:p-6">
                {renderTab()}
            </main>

            {/* Mobile Bottom Navigation */}
            <nav className="md:hidden glass-nav fixed bottom-0 w-full z-40 flex justify-around items-end pb-safe pt-1 px-2 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
                <NavItem id="dashboard" icon="fa-house" label="หน้าแรก" activeTab={activeTab} setActiveTab={setActiveTab} />
                <NavItem id="receive" icon="fa-box-open" label="รับเข้า" activeTab={activeTab} setActiveTab={setActiveTab} />
                <NavItem id="count" icon="fa-clipboard-check" label="นับหน้างาน" activeTab={activeTab} setActiveTab={setActiveTab} />
                <NavItem id="dispense" icon="fa-hand-holding-droplet" label="เบิกจ่าย" activeTab={activeTab} setActiveTab={setActiveTab} />
                <NavItem id="master" icon="fa-database" label="ข้อมูล" activeTab={activeTab} setActiveTab={setActiveTab} />
                <NavItem id="logs" icon="fa-clock-rotate-left" label="ประวัติ" activeTab={activeTab} setActiveTab={setActiveTab} />
            </nav>

            {/* Toast Notification */}
            <div className={`fixed top-4 md:top-auto md:bottom-20 left-1/2 transform -translate-x-1/2 md:translate-x-0 md:left-auto md:right-6 bg-slate-800 text-white px-5 py-3 rounded-full shadow-2xl transition duration-300 z-50 flex items-center gap-3 ${toast.show ? 'translate-y-0 opacity-100' : '-translate-y-20 md:translate-y-20 opacity-0'}`}>
                <i className={`fa-solid ${toast.type === 'success' ? 'fa-circle-check text-green-400' : 'fa-circle-exclamation text-amber-400'}`}></i>
                <span className="text-sm font-medium">{toast.msg}</span>
            </div>
        </div>
    );
}

export default App;
