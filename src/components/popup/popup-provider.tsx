'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Popup, PopupButton, PopupRows, type PopupSeverity } from './popup';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  rows?: Array<[string, React.ReactNode]>;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, and focus starts on Cancel. */
  destructive?: boolean;
  severity?: PopupSeverity;
  mobile?: 'dialog' | 'sheet';
}

export interface NoticeOptions {
  title: string;
  description?: React.ReactNode;
  severity?: PopupSeverity;
  okLabel?: string;
}

interface PopupApi {
  /** Replacement for window.confirm: resolves true on confirm, false on cancel/Esc/backdrop. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Replacement for window.alert: resolves when dismissed. */
  notify: (options: NoticeOptions) => Promise<void>;
}

type ActivePopup =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'notice'; options: NoticeOptions; resolve: () => void };

const PopupContext = createContext<PopupApi | null>(null);

export function usePopup(): PopupApi {
  const api = useContext(PopupContext);
  if (!api) throw new Error('usePopup must be used inside <PopupProvider>');
  return api;
}

export function PopupProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ActivePopup[]>([]);
  const queueRef = useRef<ActivePopup[]>([]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // Solid card instead of blur inside LINE on Android (glass is slow/unreliable there).
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua) && /Line\//i.test(ua)) {
      document.documentElement.dataset.solidPopups = 'true';
    }
  }, []);

  // Resolve anything still waiting if the provider unmounts, so awaiting callers never hang.
  useEffect(() => () => {
    queueRef.current.forEach((entry) => (entry.kind === 'confirm' ? entry.resolve(false) : entry.resolve()));
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => {
      setQueue((current) => [...current, { kind: 'confirm', options, resolve }]);
    }),
    []
  );

  const notify = useCallback(
    (options: NoticeOptions) => new Promise<void>((resolve) => {
      setQueue((current) => [...current, { kind: 'notice', options, resolve }]);
    }),
    []
  );

  const api = useMemo(() => ({ confirm, notify }), [confirm, notify]);
  const active = queue[0];

  const settle = (confirmed: boolean) => {
    if (!active) return;
    if (active.kind === 'confirm') active.resolve(confirmed);
    else active.resolve();
    setQueue((current) => current.slice(1));
  };

  return (
    <PopupContext.Provider value={api}>
      {children}
      {active?.kind === 'confirm' && (
        <Popup
          key={queue.length + active.options.title}
          open
          role="alertdialog"
          title={active.options.title}
          description={active.options.description}
          severity={active.options.severity ?? (active.options.destructive ? 'danger' : 'warning')}
          mobile={active.options.mobile ?? 'dialog'}
          onClose={() => settle(false)}
          actions={(
            <>
              <PopupButton data-autofocus={active.options.destructive ? '' : undefined} onClick={() => settle(false)}>
                {active.options.cancelLabel ?? 'ยกเลิก'}
              </PopupButton>
              <PopupButton
                variant={active.options.destructive ? 'danger' : 'primary'}
                data-autofocus={active.options.destructive ? undefined : ''}
                onClick={() => settle(true)}
              >
                {active.options.confirmLabel ?? 'ยืนยัน'}
              </PopupButton>
            </>
          )}
        >
          {active.options.rows && <PopupRows rows={active.options.rows} />}
        </Popup>
      )}
      {active?.kind === 'notice' && (
        <Popup
          key={queue.length + active.options.title}
          open
          role="alertdialog"
          title={active.options.title}
          description={active.options.description}
          severity={active.options.severity ?? 'info'}
          onClose={() => settle(true)}
          actions={<PopupButton variant="primary" data-autofocus="" onClick={() => settle(true)}>{active.options.okLabel ?? 'ตกลง'}</PopupButton>}
        />
      )}
    </PopupContext.Provider>
  );
}
