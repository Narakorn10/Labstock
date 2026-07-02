import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import AppShell from "@/components/app-shell";

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
      <body className="font-sans h-full antialiased bg-[#f5f7f9] text-[#111827]">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
