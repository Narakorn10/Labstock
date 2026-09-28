import { Barlow, IBM_Plex_Sans_Thai } from "next/font/google";
import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import AppShell from "@/components/app-shell";

const barlow = Barlow({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-barlow",
});

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  fallback: ["Tahoma", "Arial", "sans-serif"],
  variable: "--font-ibm-plex-sans-thai",
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
    <html lang="th" className={`${barlow.variable} ${ibmPlexSansThai.variable} h-full`}>
      <body className="font-sans h-full antialiased">
        {process.env.NODE_ENV === "development" && (
          <Script src="https://mcp.figma.com/mcp/html-to-design/capture.js" strategy="afterInteractive" />
        )}
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
