'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardPlus, LogOut, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from './auth-provider';
import { apiClient } from '@/lib/api-client';
import { NAVIGATION_GROUPS, getRoleFallbackMenus, mergeMenus } from '@/lib/menu-config';

const PERMISSION_CACHE_VERSION = 'v3';

interface SidebarProps {
  desktopHidden?: boolean;
}

export default function Sidebar({ desktopHidden = false }: SidebarProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [allowedMenus, setAllowedMenus] = useState<string[]>([]);
  const [isLoadingPerms, setIsLoadingPerms] = useState(true);
  const { user, logout } = useAuth();

  useEffect(() => {
    if (!user) return;

    const fetchPerms = async () => {
      try {
        const cacheKey = `perms_${PERMISSION_CACHE_VERSION}_${user.role}`;
        const fallbackMenus = getRoleFallbackMenus(user.role);
        const cached = sessionStorage.getItem(cacheKey);

        if (cached) {
          setAllowedMenus(mergeMenus(JSON.parse(cached), fallbackMenus));
          setIsLoadingPerms(false);
        }

        const data = await apiClient.getPermissions();
        let perms: string[] = [];

        if (Array.isArray(data)) {
          perms = data.find((permission) => permission.role === user.role)?.allowed_menus || [];
        } else {
          const rolePermission = data as { allowed_menus?: string[] };
          perms = rolePermission.allowed_menus || [];
        }

        const nextMenus = mergeMenus(perms, fallbackMenus);
        setAllowedMenus(nextMenus);
        sessionStorage.setItem(cacheKey, JSON.stringify(nextMenus));
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
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
          className="p-3 bg-[#123b3a] text-white rounded-lg shadow-lg shadow-[#123b3a]/20 border border-[#0d302f] active:scale-95 transition-all"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside className={`
        fixed top-0 left-0 h-full bg-[#123b3a] border-r border-[#0d302f] z-40
        transition-all duration-300 ease-in-out w-72
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        ${desktopHidden ? 'lg:-translate-x-full' : 'lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-[#dcece7] border border-white/15">
                <ClipboardPlus size={22} strokeWidth={1.8} />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white tracking-tight">LabStock</h1>
                <p className="text-[10px] font-medium text-[#b9d6ce] tracking-[0.12em]">CLINICAL INVENTORY</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-7 overflow-y-auto no-scrollbar">
            {isLoadingPerms && allowedMenus.length === 0 ? (
              <div className="space-y-4 p-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-10 bg-white/10 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              NAVIGATION_GROUPS.map((group) => {
                const filteredItems = group.items.filter((item) => allowedMenus.includes(item.id));

                if (filteredItems.length === 0) return null;

                return (
                  <div key={group.title} className="space-y-2">
                    <div className="flex items-center px-4 mb-2">
                      <span className="text-[10px] font-semibold text-[#9dc0b7] tracking-[0.14em]">
                        {group.title}
                      </span>
                      <div className="ml-3 flex-1 h-px bg-white/10" />
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
                              flex items-center gap-3 px-3.5 py-2.5 rounded-lg transition-all duration-200 group/item
                              ${isActive
                                ? 'bg-white text-[#123b3a] font-semibold shadow-sm'
                                : 'text-[#c3d7d2] hover:bg-white/10 hover:text-white'}
                            `}
                          >
                            <Icon
                              size={18}
                              className={`transition-colors ${isActive ? 'text-[#2f6f67]' : 'text-[#8eb5aa] group-hover/item:text-white'}`}
                            />
                            <span className="text-sm font-semibold tracking-tight">{item.name}</span>
                            {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#2f6f67]" />}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </nav>

          <div className="p-4 border-t border-white/10 space-y-3">
            <div className="p-3 bg-white/8 rounded-lg border border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/10 text-white flex items-center justify-center font-semibold text-sm">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate tracking-tight">{user.name}</p>
                  <p className="text-[10px] font-medium text-[#a9c9c1] tracking-wide">{user.role}</p>
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-[#f1c2bd] hover:bg-white/10 hover:text-white transition-all font-semibold text-xs tracking-wide active:scale-95"
            >
              <LogOut size={16} />
              ออกจากระบบ
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
