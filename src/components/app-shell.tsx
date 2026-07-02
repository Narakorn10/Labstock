'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/sidebar';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isMobileSurface = pathname.startsWith('/mobile');

  if (isMobileSurface) {
    return (
      <div className="min-h-screen bg-[#f5f7f9]">
        <main className="min-h-screen">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 lg:ml-64 min-h-screen flex flex-col relative">
        <div className="flex-1 p-6 md:p-10 max-w-7xl mx-auto w-full">
          {children}
        </div>
        <footer className="p-8 text-center text-[#6b7280] text-xs border-t border-[#e5e7eb] bg-white">
          <div className="flex items-center justify-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#166ee1]" />
            <p className="font-semibold tracking-tight">LabStock Workspace | Medical Technology Hub</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
