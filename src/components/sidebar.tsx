'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { apiClient } from '@/lib/api-client';
import { NAVIGATION_GROUPS, getRoleFallbackMenus, mergeMenus } from '@/lib/menu-config';

const PERMISSION_CACHE_VERSION = 'v3';

const ROLE_LABELS: Record<string, string> = {
  Admin: 'ผู้ดูแลระบบ',
  Manager: 'หัวหน้างาน',
  Operator: 'นักเทคนิคการแพทย์',
  User: 'ผู้ช่วยห้องปฏิบัติการ',
  Vendor: 'บริษัทคู่ค้า',
};

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
          className="flex size-11 items-center justify-center rounded-xl border border-line bg-white text-ink shadow-sm transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {isOpen ? <X size={22} strokeWidth={1.5} /> : <Menu size={22} strokeWidth={1.5} />}
        </button>
      </div>

      {isOpen && (
        <button
          type="button"
          aria-label="ปิดเมนูหลัก"
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        ref={sidebarRef}
        id="primary-navigation"
        aria-label="เมนูหลัก"
        aria-hidden={desktopHidden && !isOpen ? true : undefined}
        className={`
        fixed top-0 left-0 z-40 h-full w-[260px] border-r border-line bg-[#fafafa]
        transition-[opacity,transform,visibility] duration-300 ease-in-out
        ${isOpen ? 'visible translate-x-0 opacity-100' : 'invisible pointer-events-none -translate-x-full opacity-0'}
        ${desktopHidden ? 'lg:invisible lg:pointer-events-none lg:-translate-x-full lg:opacity-0' : 'lg:visible lg:pointer-events-auto lg:translate-x-0 lg:opacity-100'}
      `}>
        <div className="flex flex-col h-full">
          <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Image src="/images/logo-spr-lab.png" alt="" width={38} height={38} className="size-[38px] shrink-0 rounded-[9px]" />
              <div className="min-w-0 leading-[1.15]">
                <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">LabStock</h1>
                <p className="truncate text-[11px] text-ink-muted">SPR LAB · รพ.สวรรค์ประชารักษ์</p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="ปิดเมนู"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-gray-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:hidden"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>

          <nav aria-label="เมนูนำทางหลัก" aria-busy={isLoadingPerms} className="flex-1 overflow-y-auto px-3 pb-4 pt-2 no-scrollbar">
            {isLoadingPerms && allowedMenus.length === 0 ? (
              <div className="space-y-4 p-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-10 rounded-xl bg-gray-200/70 animate-pulse" />
                ))}
              </div>
            ) : (
              NAVIGATION_GROUPS.map((group) => {
                const filteredItems = group.items.filter((item) => allowedMenus.includes(item.id));

                if (filteredItems.length === 0) return null;

                return (
                  <div key={group.title} className="pt-3.5">
                    <div className="flex items-center gap-2 px-2.5 pb-1.5 text-[13px] text-gray-600">
                      <span className="size-3 shrink-0 rounded-full border-[1.5px] border-dashed border-gray-400" aria-hidden="true" />
                      {group.title}
                    </div>
                    <div>
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
                              group/item relative flex items-center gap-2 rounded-[10px] px-3 py-[9px] text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                              ${isActive
                                ? 'bg-gray-200 font-semibold text-ink!'
                                : 'text-gray-800! hover:bg-gray-200'}
                            `}
                          >
                            <Icon
                                size={18}
                                strokeWidth={1.5}
                                className="shrink-0"
                            />
                            <span className="min-w-0 flex-1">{item.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </nav>

          <div className="m-3 flex shrink-0 flex-col gap-2.5 rounded-2xl border border-line bg-white p-3.5">
            <div className="flex items-center gap-2.5">
              <div className="grid size-[34px] shrink-0 place-items-center rounded-full bg-gray-200 font-semibold text-ink">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
                <p className="truncate text-xs text-gray-600">{ROLE_LABELS[user.role] ?? user.role}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="flex w-fit items-center gap-1.5 text-[13px] text-crit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <LogOut size={16} strokeWidth={1.5} />
              ออกจากระบบ
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
