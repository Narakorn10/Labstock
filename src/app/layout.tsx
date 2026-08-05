import { Noto_Sans_Thai } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import AppShell from "@/components/app-shell";

const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai", "latin", "latin-ext"],
  display: "swap",
  fallback: ["Tahoma", "Arial", "sans-serif"],
  variable: "--font-noto-sans-thai",
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
    <html lang="th" className={`${notoSansThai.variable} h-full`}>
      <body className="font-sans h-full antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
