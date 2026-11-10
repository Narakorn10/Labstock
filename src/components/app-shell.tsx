'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import Sidebar from '@/components/sidebar';
import { useAuth } from '@/components/auth-provider';
import { NAVIGATION_GROUPS } from '@/lib/menu-config';

interface AppShellProps {
  children: React.ReactNode;
}

/** Finds the menu entry (most specific href) that the current path belongs to. */
function findCrumb(pathname: string) {
  let best: { group: string; label: string; length: number } | null = null;
  for (const group of NAVIGATION_GROUPS) {
    for (const item of group.items) {
      const matches = pathname === item.href || pathname.startsWith(item.href + '/');
      if (matches && (!best || item.href.length > best.length)) {
        best = { group: group.title, label: item.label, length: item.href.length };
      }
    }
  }
  return best;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isMobileSurface = pathname.startsWith('/mobile');
  const isPublicSurface = pathname === '/' || pathname === '/login';
  // The sidebar is an icon rail that widens on hover; the page moves over with it instead of being covered.
  const [sidebarWide, setSidebarWide] = useState(false);
  const { user } = useAuth();
  const crumb = findCrumb(pathname);
  // The header (breadcrumb) only makes sense with a signed-in user. LIFF and
  // sign-up pages keep the original spacing so their layout does not change.
  const showHeader = Boolean(user);

  if (isMobileSurface) {
    return (
      <div className="min-h-screen bg-gray-50">
        <a
          href="#app-main"
          className="sr-only z-[60] rounded-lg bg-clinical-900 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          ข้ามไปยังเนื้อหาหลัก
        </a>
        <main id="app-main" tabIndex={-1} className="min-h-screen">{children}</main>
      </div>
    );
  }

  if (isPublicSurface) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div className="flex min-h-screen bg-transparent">
      <a
        href="#app-main"
        className="sr-only z-[60] rounded-lg bg-clinical-900 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <Sidebar onExpandedChange={setSidebarWide} />
      <main
        id="app-main"
        tabIndex={-1}
        className={`relative flex min-h-screen min-w-0 flex-1 flex-col transition-[margin] duration-200 ease-in-out ${showHeader ? (sidebarWide ? 'lg:ml-[260px]' : 'lg:ml-[68px]') : 'lg:ml-0'}`}
      >
        {showHeader && (
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white pl-16 pr-4 lg:gap-4 lg:px-8">
          {crumb && (
            <nav aria-label="ตำแหน่งหน้าปัจจุบัน" className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden text-gray-600 sm:inline">{crumb.group}</span>
              <span className="hidden text-gray-400 sm:inline" aria-hidden="true">/</span>
              <span className="truncate text-[15px] font-medium text-ink" aria-current="page">{crumb.label}</span>
            </nav>
          )}
        </header>
        )}
        <div className={`mx-auto w-full max-w-[1440px] flex-1 px-4 pb-12 sm:px-6 lg:px-10 lg:pb-[72px] ${showHeader ? 'pt-6 lg:pt-8' : 'pt-20 lg:pt-8'}`}>
          {children}
        </div>
        <footer className="border-t border-line bg-white/80 px-6 py-5 text-center text-xs text-ink-muted backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2.5">
            <div className="size-2 rounded-full bg-gray-400" aria-hidden="true" />
            <p className="font-medium tracking-wide">LabStock · ระบบบริหารคลังน้ำยา</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
