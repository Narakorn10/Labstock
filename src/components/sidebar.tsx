'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  PackagePlus, 
  Package,
  HandHelping, 
  History, 
  Database, 
  Settings,
  Menu,
  X,
  CheckCircle2,
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Shield,
  LogOut,
  ScanLine,
  ShoppingCart,
  BellRing
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from './auth-provider';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ['Admin', 'Manager', 'Operator', 'User', 'Vendor'] },
  { name: 'สั่งซื้อน้ำยา (Purchase Orders)', href: '/orders', icon: ShoppingCart, roles: ['Admin', 'Manager', 'User'] },
  { name: 'รับออเดอร์ (Vendor POs)', href: '/vendor/orders', icon: ShoppingCart, roles: ['Vendor'] },
  { name: 'Analysis (วิเคราะห์)', href: '/analysis', icon: BarChart3, roles: ['Admin', 'Manager', 'User'] },
  { name: 'Stock Count (นับ)', href: '/count', icon: CheckCircle2, roles: ['Admin', 'Manager', 'User', 'Vendor'] },
  { name: 'แจ้งส่งของ (Shipments)', href: '/vendor/shipments', icon: PackagePlus, roles: ['Vendor'] },
  { name: 'รับสินค้าจากบริษัท', href: '/receive/vendor', icon: Package, roles: ['Admin', 'Manager', 'User'] },
  { name: 'ระบบยืม (Borrow)', href: '/borrow', icon: ArrowDownToLine, roles: ['Admin', 'Manager', 'User'] },
  { name: 'ระบบให้ยืม (Lend)', href: '/lend', icon: ArrowUpFromLine, roles: ['Admin', 'Manager', 'User'] },
  { name: 'Receive (รับเข้า)', href: '/receive', icon: PackagePlus, roles: ['Admin', 'Manager', 'User', 'Vendor'] },
  { name: 'Dispense (เบิกจ่าย)', href: '/dispense', icon: HandHelping, roles: ['Admin', 'Manager', 'Operator', 'User'] },
  { name: 'Logs (ประวัติ)', href: '/logs', icon: History, roles: ['Admin', 'Manager', 'User'] },
  { name: 'Master Data', href: '/master', icon: Database, roles: ['Admin', 'Manager'] },
  { name: 'Main Stock (คลังใหญ่)', href: '/master/inventory', icon: Package, roles: ['Admin', 'Manager'] },
  { name: 'User Management', href: '/master/users', icon: Shield, roles: ['Admin'] },
  { name: 'SQL Explorer', href: '/admin/sql', icon: Database, roles: ['Admin'] },
  { name: 'Settings (ตั้งค่า)', href: '/settings', icon: Settings, roles: ['Admin', 'Manager'] },
  { name: 'ตั้งค่าการแจ้งเตือน (Notifications)', href: '/settings/notifications', icon: BellRing, roles: ['Admin', 'Manager', 'Operator', 'User', 'Vendor'] },
  { name: 'สอนอ่านบาร์โค้ด', href: '/settings/barcodes', icon: ScanLine, roles: ['Admin', 'Manager'] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const { user, logout } = useAuth();

  if (!user) return null;

  const filteredNavigation = navigation.filter(item => item.roles.includes(user.role));

  return (
    <>
      {/* Mobile Menu Button */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-3 bg-blue-600 text-white rounded-xl shadow-lg border border-blue-700 active:scale-95 transition-all"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar Overlay for Mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside className={`
        fixed top-0 left-0 h-full bg-white border-r border-[#e5e7eb] z-40
        transition-all duration-300 ease-in-out w-64
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full">
          {/* Logo Area */}
          <div className="p-6 border-b border-[#f3f4f6]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-[#166ee1] rounded-lg flex items-center justify-center text-white shadow-sm">
                <Database size={22} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 tracking-tight">LabStock</h1>
                <p className="text-[10px] font-semibold text-[#166ee1] uppercase tracking-wider">Base Workspace</p>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto no-scrollbar">
            {filteredNavigation.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-150
                    ${isActive 
                      ? 'bg-[#e7f0ff] text-[#166ee1] font-bold' 
                      : 'text-gray-600 hover:bg-[#f3f4f6] hover:text-gray-900'}
                  `}
                >
                  <Icon size={18} className={isActive ? 'text-[#166ee1]' : 'text-gray-400'} />
                  <span className="text-sm font-medium">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* Footer Area */}
          <div className="p-4 border-t border-[#f3f4f6] space-y-3">
            <div className="p-3 bg-[#f9fafb] rounded-xl border border-[#f3f4f6]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">{user.name}</p>
                  <p className="text-[10px] font-medium text-[#6b7280] uppercase tracking-tighter">{user.role}</p>
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors font-bold text-xs"
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
