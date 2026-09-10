'use client';

import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import Sidebar from '@/components/sidebar';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isMobileSurface = pathname.startsWith('/mobile');
  const isPublicSurface = pathname === '/' || pathname === '/login';
  const [sidebarHidden, setSidebarHidden] = useState(false);

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
      <div className="min-h-screen bg-[#f6f8f7]">
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
      <button
        type="button"
        onClick={() => setSidebarHidden((current) => !current)}
        aria-label={sidebarHidden ? 'แสดงเมนูด้านข้าง' : 'ซ่อนเมนูด้านข้าง'}
        aria-controls="primary-navigation"
        aria-expanded={!sidebarHidden}
        aria-keyshortcuts="Control+B Meta+B"
        title={sidebarHidden ? 'แสดงเมนูด้านข้าง (Ctrl+B)' : 'ซ่อนเมนูด้านข้าง (Ctrl+B)'}
        className={`hidden lg:inline-flex fixed top-5 z-30 size-10 items-center justify-center rounded-lg border border-clinical-border bg-white text-clinical-700 shadow-sm transition-all hover:bg-[#eff6f3] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700 ${sidebarHidden ? 'left-5' : 'left-[18.5rem]'}`}
      >
        {sidebarHidden ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
      </button>
      <main
        id="app-main"
        tabIndex={-1}
        className={`relative flex min-h-screen min-w-0 flex-1 flex-col transition-[margin] duration-300 ${sidebarHidden ? 'lg:ml-0' : 'lg:ml-72'}`}
      >
        <div className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-10 pt-20 sm:px-6 sm:pb-12 sm:pt-20 lg:px-10 lg:pt-8 xl:px-12">
          {children}
        </div>
        <footer className="border-t border-clinical-border bg-white/80 px-6 py-5 text-center text-xs text-[var(--clinical-muted)] backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2.5">
            <div className="size-2 rounded-full bg-clinical-700" aria-hidden="true" />
            <p className="font-medium tracking-wide">LabStock · ระบบบริหารคลังน้ำยา</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
