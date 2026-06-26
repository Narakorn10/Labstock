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
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Shield,
  LogOut,
  ScanLine,
  ShoppingCart,
  BellRing,
  ShieldCheck
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from './auth-provider';
import { apiClient } from '@/lib/api-client';

const navigationGroups = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', name: 'Inventory Overview', href: '/', icon: LayoutDashboard },
      { id: 'analysis', name: 'Analysis (วิเคราะห์)', href: '/analysis', icon: BarChart3 },
      { id: 'logs', name: 'Logs (ประวัติ)', href: '/logs', icon: History },
    ]
  },
  {
    title: 'Operations',
    items: [
      { id: 'dispense', name: 'Dispense (เบิกจ่าย)', href: '/dispense', icon: HandHelping },
      { id: 'receive', name: 'Receive (รับเข้า)', href: '/receive', icon: PackagePlus },
      { id: 'count', name: 'Stock Count (นับ)', href: '/count', icon: CheckCircle2 },
      { id: 'borrow', name: 'ระบบยืม (Borrow)', href: '/borrow', icon: ArrowDownToLine },
      { id: 'lend', name: 'ระบบให้ยืม (Lend)', href: '/lend', icon: ArrowUpFromLine },
    ]
  },
  {
    title: 'Procurement',
    items: [
      { id: 'orders', name: 'สั่งซื้อน้ำยา (PO)', href: '/orders', icon: ShoppingCart },
      { id: 'receive_vendor', name: 'รับสินค้าจากบริษัท', href: '/receive/vendor', icon: Package },
      { id: 'vendor_orders', name: 'รับออเดอร์ (Vendor PO)', href: '/vendor/orders', icon: ShoppingCart },
      { id: 'vendor_shipments', name: 'แจ้งส่งของ (Shipments)', href: '/vendor/shipments', icon: PackagePlus },
    ]
  },
  {
    title: 'Management',
    items: [
      { id: 'master_data', name: 'Master Data', href: '/master', icon: Database },
      { id: 'user_management', name: 'User Management', href: '/master/users', icon: Shield },
      { id: 'rbac', name: 'Permissions (RBAC)', href: '/master/permissions', icon: ShieldCheck },
    ]
  },
  {
    title: 'Settings',
    items: [
      { id: 'settings', name: 'Settings (ตั้งค่า)', href: '/settings', icon: Settings },
      { id: 'notifications', name: 'Notifications', href: '/settings/notifications', icon: BellRing },
      { id: 'barcodes', name: 'สอนอ่านบาร์โค้ด', href: '/settings/barcodes', icon: ScanLine },
    ]
  }
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [allowedMenus, setAllowedMenus] = useState<string[]>([]);
  const [isLoadingPerms, setIsLoadingPerms] = useState(true);
  const { user, logout } = useAuth();

  useEffect(() => {
    if (!user) return;

    const fetchPerms = async () => {
      try {
        // Try to get from session storage first for speed
        const cached = sessionStorage.getItem(`perms_${user.role}`);
        if (cached) {
          setAllowedMenus(JSON.parse(cached));
          setIsLoadingPerms(false);
        }

        const data = await apiClient.getPermissions();
        let perms: string[] = [];
        
        if (Array.isArray(data)) {
          perms = data.find(p => p.role === user.role)?.allowed_menus || [];
        } else {
          const rolePermission = data as { allowed_menus?: string[] };
          perms = rolePermission.allowed_menus || [];
        }
        
        setAllowedMenus(perms);
        sessionStorage.setItem(`perms_${user.role}`, JSON.stringify(perms));
      } catch (err) {
        console.error('Failed to fetch sidebar permissions:', err);
      } finally {
        setIsLoadingPerms(false);
      }
    };

    fetchPerms();
  }, [user]);

  if (!user) return null;

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
          <nav className="flex-1 p-3 space-y-7 overflow-y-auto no-scrollbar">
            {isLoadingPerms && allowedMenus.length === 0 ? (
              <div className="space-y-4 p-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-10 bg-gray-50 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : (
              navigationGroups.map((group) => {
                const filteredItems = group.items.filter(item => allowedMenus.includes(item.id));
                
                if (filteredItems.length === 0) return null;

                return (
                  <div key={group.title} className="space-y-2">
                    <div className="flex items-center px-4 mb-2">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                        {group.title}
                      </span>
                      <div className="ml-2 flex-1 h-[1px] bg-gray-100" />
                    </div>
                    <div className="space-y-1">
                      {filteredItems.map((item) => {
                        const isActive = pathname === item.href;
                        const Icon = item.icon;
                        
                        return (
                          <Link
                            key={item.id}
                            href={item.href}
                            onClick={() => setIsOpen(false)}
                            className={`
                              flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 group/item
                              ${isActive 
                                ? 'bg-[#e7f0ff] text-[#166ee1] font-bold shadow-sm' 
                                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}
                            `}
                          >
                            <Icon 
                              size={18} 
                              className={`transition-colors ${isActive ? 'text-[#166ee1]' : 'text-gray-400 group-hover/item:text-gray-600'}`} 
                            />
                            <span className="text-sm font-semibold tracking-tight">{item.name}</span>
                            {isActive && (
                              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#166ee1]" />
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </nav>

          {/* Footer Area */}
          <div className="p-4 bg-gray-50/50 border-t border-[#f3f4f6] space-y-3">
            <div className="p-3 bg-white rounded-2xl border border-[#f3f4f6] shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#166ee1]/10 text-[#166ee1] flex items-center justify-center font-black text-sm">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-gray-900 truncate tracking-tight">{user.name}</p>
                  <p className="text-[10px] font-bold text-[#166ee1] uppercase tracking-tighter opacity-80">{user.role}</p>
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-all font-bold text-xs uppercase tracking-widest active:scale-95"
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
