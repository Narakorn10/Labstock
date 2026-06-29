import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/sidebar";
import { AuthProvider } from "@/components/auth-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LabStock | Cloud Data Management",
  description: "User-friendly laboratory inventory system with real-time data sync",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans h-full antialiased bg-[#f5f7f9] text-[#111827]`}>
        <AuthProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 lg:ml-64 min-h-screen flex flex-col relative">
              <div className="flex-1 p-6 md:p-10 max-w-7xl mx-auto w-full">
                {children}
              </div>
              <footer className="p-8 text-center text-[#6b7280] text-xs border-t border-[#e5e7eb] bg-white">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#166ee1]"></div>
                  <p className="font-semibold tracking-tight">LabStock Workspace | Medical Technology Hub</p>
                </div>
              </footer>
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
