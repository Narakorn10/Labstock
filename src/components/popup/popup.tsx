'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from 'lucide-react';

export type PopupSeverity = 'info' | 'warning' | 'danger' | 'success';

const SEVERITY_ICON = {
  info: Info,
  warning: TriangleAlert,
  danger: OctagonAlert,
  success: CircleCheck,
} as const;

const SEVERITY_COLOR: Record<PopupSeverity, string> = {
  info: '#3f5f80',
  warning: 'oklch(0.5 0.11 65)',
  danger: 'oklch(0.5 0.19 27)',
  success: 'oklch(0.45 0.12 150)',
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PopupProps {
  open: boolean;
  /** Called on Esc and backdrop click. Skip it (undefined) to force an explicit choice. */
  onClose?: () => void;
  title: string;
  description?: React.ReactNode;
  severity?: PopupSeverity;
  /** Mobile layout: bottom sheet (dispense, receive, reject PO) or centered dialog. Desktop is always centered. */
  mobile?: 'dialog' | 'sheet';
  /** Rows/inputs shown between the description and the buttons. */
  children?: React.ReactNode;
  /** Buttons. Use PopupButton. */
  actions?: React.ReactNode;
  /** Use alertdialog for confirmations that need an answer. */
  role?: 'dialog' | 'alertdialog';
}

export function Popup({
  open,
  onClose,
  title,
  description,
  severity = 'info',
  mobile = 'dialog',
  children,
  actions,
  role = 'dialog',
}: PopupProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Destructive actions start on the safe choice: prefer the data-autofocus button, else the first one.
    const card = cardRef.current;
    const focusables = card ? Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    (card?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables[0] ?? card)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onCloseRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !cardRef.current) return;
      const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const Icon = SEVERITY_ICON[severity];
  const isSheet = mobile === 'sheet';

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex justify-center ${isSheet ? 'items-end sm:items-center' : 'items-center'} sm:p-6 ${isSheet ? '' : 'p-3.5'}`}
    >
      <div className="popup-backdrop absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={cardRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-sheet={isSheet}
        className={`popup-card relative flex max-h-[92dvh] w-full max-w-[420px] flex-col gap-4 overflow-y-auto outline-none sm:rounded-[28px] sm:p-6 ${
          isSheet
            ? 'rounded-t-[32px] px-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-[22px]'
            : 'rounded-[28px] p-5'
        }`}
      >
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden="true"
            className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-white/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.9)]"
            style={{ color: SEVERITY_COLOR[severity] }}
          >
            <Icon size={22} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 id={titleId} className="text-[19px] font-semibold leading-snug">{title}</h2>
            {description && <div id={descriptionId} className="mt-1 text-sm leading-6 text-[#3c4650]">{description}</div>}
          </div>
        </div>
        {children}
        {actions && <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}

/** Row box for key/value summaries inside a popup. */
export function PopupRows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="rounded-[18px] bg-white/45 px-4 py-0.5">
      {rows.map(([label, value], index) => (
        <div key={label} className={`flex items-baseline justify-between gap-4 py-2.5 text-sm ${index > 0 ? 'border-t border-[rgba(60,80,105,0.18)]' : ''}`}>
          <dt className="text-[#3c4650]">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface PopupButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
}

export function PopupButton({ variant = 'secondary', className = '', type = 'button', ...props }: PopupButtonProps) {
  const styles = {
    primary: 'bg-[#1d1f20] text-white border-white/40',
    danger: 'bg-[oklch(0.55_0.19_27)] text-white border-white/40',
    secondary: 'bg-white/60 text-[#1d1f20] border-white/90',
  }[variant];

  return (
    <button
      type={type}
      className={`min-h-12 rounded-full border px-5 text-[15px] font-medium transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3f5f80] sm:min-h-11 ${styles} ${className}`}
      {...props}
    />
  );
}
