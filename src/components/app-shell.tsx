'use client';

import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import Sidebar from '@/components/sidebar';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isMobileSurface = pathname.startsWith('/mobile');
  const [sidebarHidden, setSidebarHidden] = useState(false);

  if (isMobileSurface) {
    return (
      <div className="min-h-screen bg-[#f6f8f7]">
        <main className="min-h-screen">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-transparent">
      <Sidebar desktopHidden={sidebarHidden} />
      <button
        type="button"
        onClick={() => setSidebarHidden((current) => !current)}
        aria-label={sidebarHidden ? 'แสดงเมนูด้านข้าง' : 'ซ่อนเมนูด้านข้าง'}
        aria-pressed={sidebarHidden}
        className={`hidden lg:inline-flex fixed top-5 z-30 items-center justify-center w-10 h-10 rounded-lg border border-[#d9e3df] bg-white text-[#2f6f67] shadow-sm hover:bg-[#eff6f3] active:scale-95 transition-all ${sidebarHidden ? 'left-5' : 'left-[19rem]'}`}
      >
        {sidebarHidden ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
      </button>
      <main className={`flex-1 min-h-screen flex flex-col relative transition-[margin] duration-300 ${sidebarHidden ? 'lg:ml-0' : 'lg:ml-72'}`}>
        <div className="flex-1 p-5 pt-20 md:p-10 md:pt-10 max-w-[1440px] mx-auto w-full">
          {children}
        </div>
        <footer className="px-6 py-5 text-center text-[#687875] text-xs border-t border-[#d9e3df] bg-white/75">
          <div className="flex items-center justify-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-[#2f6f67]" />
            <p className="font-medium tracking-wide">LabStock · ระบบบริหารคลังน้ำยา</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
