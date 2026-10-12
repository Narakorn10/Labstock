"use client";

import "./globals.css";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  // Replaces the root layout: plain markup only, no providers. Never render error.message.
  return (
    <html lang="th">
      <body className="font-sans antialiased">
        <title>เกิดข้อผิดพลาด | LabStock</title>
        <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center p-4">
          <div className="air-card w-full rounded-2xl text-center" role="alert">
            <h1 className="text-xl font-semibold text-text">เกิดข้อผิดพลาดในการแสดงหน้านี้</h1>
            <p className="mt-3 rounded-lg bg-crit-bg p-3 text-sm text-crit">
              วิธีแก้เบื้องต้น: กด “ลองอีกครั้ง” หรือรีเฟรชหน้า ถ้ายังไม่หาย ให้แจ้งผู้ดูแลพร้อมรหัสอ้างอิง
            </p>
            {error.digest ? (
              <p className="mt-3 text-sm text-text-muted">
                รหัสอ้างอิง: <span className="font-mono text-text">{error.digest}</span>
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={() => unstable_retry()} className="air-btn-primary">
                ลองอีกครั้ง
              </button>
              {/* Plain anchor on purpose: a full page load resets a broken app state. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="rounded-lg border border-border bg-surface px-4 py-2 font-semibold text-text hover:bg-surface-muted"
              >
                กลับหน้าแรก
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
