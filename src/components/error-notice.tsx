'use client';

import { useState } from 'react';
import { parseApiError, type ApiErrorInfo } from '@/lib/api-errors-client';
import type { usePopup } from '@/components/popup/popup-provider';

function CopyRequestId({ requestId }: { requestId: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (e.g. in-app browsers); the ID stays visible to read out.
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <span>รหัสอ้างอิง: <span className="font-mono">{requestId}</span></span>
      <button type="button" onClick={copy} className="rounded border border-current px-2 py-0.5 text-xs font-medium">
        {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
      </button>
    </span>
  );
}

export function ErrorNotice({ error, onRetry, onDismiss, compact = false }: {
  error: ApiErrorInfo | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}) {
  if (!error) return null;

  return (
    <div role="alert" className={`rounded-xl bg-crit-bg text-crit ${compact ? 'p-2 text-xs' : 'p-4 text-sm'} space-y-1`}>
      <p className="font-bold">{error.message}</p>
      {error.hint && <p>วิธีแก้เบื้องต้น: {error.hint}</p>}
      {error.requestId && <p className="text-xs"><CopyRequestId requestId={error.requestId} /></p>}
      {(onRetry || onDismiss) && (
        <div className="flex gap-2 pt-1">
          {onRetry && <button type="button" onClick={onRetry} className="rounded border border-current px-3 py-1 text-xs font-medium">ลองใหม่</button>}
          {onDismiss && <button type="button" onClick={onDismiss} className="rounded border border-current px-3 py-1 text-xs font-medium">ปิด</button>}
        </div>
      )}
    </div>
  );
}

/** Popup version of ErrorNotice, replacing window.alert for failed API calls. */
export function notifyApiError(popup: ReturnType<typeof usePopup>, err: unknown, fallback: string): Promise<void> {
  const info = parseApiError(err, fallback);
  return popup.notify({
    title: info.message,
    severity: 'danger',
    description: (
      <div className="space-y-1">
        {info.hint && <p>วิธีแก้เบื้องต้น: {info.hint}</p>}
        {info.requestId && <p className="text-xs"><CopyRequestId requestId={info.requestId} /></p>}
      </div>
    ),
  });
}
