'use client';

import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const { user } = useAuth();
  const crumb = findCrumb(pathname);
  // The header (breadcrumb + sidebar toggle) only makes sense with a signed-in user. LIFF and
  // sign-up pages keep the original spacing so their layout does not change.
  const showHeader = Boolean(user);

  useEffect(() => {
    const handleSidebarShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );

      if (
        isTyping ||
        !window.matchMedia('(min-width: 64rem)').matches ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'b'
      ) {
        return;
      }

      event.preventDefault();
      setSidebarHidden((current) => !current);
    };

    window.addEventListener('keydown', handleSidebarShortcut);
    return () => window.removeEventListener('keydown', handleSidebarShortcut);
  }, []);

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
      <Sidebar desktopHidden={sidebarHidden} />
      <main
        id="app-main"
        tabIndex={-1}
        className={`relative flex min-h-screen min-w-0 flex-1 flex-col transition-[margin] duration-300 ${showHeader && !sidebarHidden ? 'lg:ml-[260px]' : 'lg:ml-0'}`}
      >
        {showHeader && (
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/90 pl-16 pr-4 backdrop-blur lg:px-6">
          <button
            type="button"
            onClick={() => setSidebarHidden((current) => !current)}
            aria-label={sidebarHidden ? 'แสดงเมนูด้านข้าง' : 'ซ่อนเมนูด้านข้าง'}
            aria-controls="primary-navigation"
            aria-expanded={!sidebarHidden}
            aria-keyshortcuts="Control+B Meta+B"
            title={sidebarHidden ? 'แสดงเมนูด้านข้าง (Ctrl+B)' : 'ซ่อนเมนูด้านข้าง (Ctrl+B)'}
            className="hidden size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-gray-100 hover:text-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:inline-flex"
          >
            {sidebarHidden ? <PanelLeftOpen size={19} strokeWidth={1.5} /> : <PanelLeftClose size={19} strokeWidth={1.5} />}
          </button>
          {crumb && (
            <nav aria-label="ตำแหน่งหน้าปัจจุบัน" className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden text-ink-muted sm:inline">{crumb.group}</span>
              <span className="hidden text-gray-300 sm:inline" aria-hidden="true">/</span>
              <span className="truncate font-medium text-ink" aria-current="page">{crumb.label}</span>
            </nav>
          )}
        </header>
        )}
        <div className={`mx-auto w-full max-w-[1600px] flex-1 px-4 pb-10 sm:px-6 sm:pb-12 lg:px-10 xl:px-12 ${showHeader ? 'pt-6' : 'pt-20 lg:pt-8'}`}>
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
