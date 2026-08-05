'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardPlus, LogOut, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const originalOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        return;
      }

      if (event.key !== 'Tab' || !sidebarRef.current) return;

      const focusableElements = Array.from(
        sidebarRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!user) return null;

  return (
    <>
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          aria-label={isOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
          aria-controls="primary-navigation"
          aria-expanded={isOpen}
          className="flex size-11 items-center justify-center rounded-lg border border-[#0d302f] bg-clinical-900 text-white shadow-lg shadow-[#123b3a]/20 transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
        >
          {isOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {isOpen && (
        <button
          type="button"
          aria-label="ปิดเมนูหลัก"
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        ref={sidebarRef}
        id="primary-navigation"
        aria-label="เมนูหลัก"
        aria-hidden={desktopHidden && !isOpen ? true : undefined}
        className={`
        fixed top-0 left-0 z-40 h-full w-72 border-r border-[#0b3034] bg-[#083f46]
        transition-[opacity,transform,visibility] duration-300 ease-in-out
        ${isOpen ? 'visible translate-x-0 opacity-100' : 'invisible pointer-events-none -translate-x-full opacity-0'}
        ${desktopHidden ? 'lg:invisible lg:pointer-events-none lg:-translate-x-full lg:opacity-0' : 'lg:visible lg:pointer-events-auto lg:translate-x-0 lg:opacity-100'}
      `}>
        <div className="flex flex-col h-full">
          <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-[#dcece7] border border-white/15">
                <ClipboardPlus size={22} strokeWidth={1.8} />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white tracking-tight">LabStock</h1>
                <p className="text-[10px] font-medium text-[#b9d6ce] tracking-[0.12em]">CLINICAL INVENTORY</p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="ปิดเมนู"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/15 text-[#dcece7] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dcece7] lg:hidden"
            >
              <X size={18} />
            </button>
          </div>

          <nav aria-label="เมนูนำทางหลัก" aria-busy={isLoadingPerms} className="flex-1 space-y-7 overflow-y-auto p-4 no-scrollbar">
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
                      <span className="text-[10px] font-semibold text-[#e0f0ec] tracking-[0.14em]">
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
                            aria-current={isActive ? 'page' : undefined}
                            className={`
                              group/item relative flex items-center gap-3 rounded-lg px-3.5 py-2.5 transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dcece7]
                              ${isActive
                                ? 'bg-white font-semibold text-clinical-900 shadow-sm ring-1 ring-white/80'
                                : '!text-[#d5e5e2] hover:bg-white/10 hover:!text-white'}
                            `}
                          >
                            <Icon
                                size={18}
                                className={`transition-colors ${isActive ? 'text-[#2f6f67]' : 'text-[#d5ebe5] group-hover/item:text-white'}`}
                            />
                            <span className="text-sm font-semibold tracking-tight">{item.name}</span>
                            {isActive && <div className="ml-auto size-1.5 rounded-full bg-[#4aa7b5]" aria-hidden="true" />}
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
              type="button"
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-lg px-3.5 py-3 text-xs font-semibold tracking-wide text-[#f1c2bd] transition-all hover:bg-white/10 hover:text-white active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dcece7]"
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
