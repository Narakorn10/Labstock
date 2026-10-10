"use client";

// Department switcher (step 6, step 5). Two layers:
//  - DepartmentSwitcherView: props only, no hooks, no fetch (easy to test with renderToStaticMarkup).
//  - DepartmentSwitcher: wrapper with useReducer(switcherReducer); it is the only place that sends the POST.
// No next-auth / next/navigation / server imports on purpose. The caller (sidebar, step 7) owns the reload.
import { useEffect, useReducer, useRef, useState } from "react";
import { fetchDepartmentContext, switchDepartment } from "@/lib/department-session-client";
import {
  ALL_LABEL,
  SWITCH_FALLBACK_MESSAGE,
  initialSwitcherState,
  isSwitcherEngaged,
  shouldShowLoadError,
  shouldShowSwitcher,
  switcherChoices,
  switcherReducer,
  type DepartmentContext,
  type SwitcherState,
  type SwitchTarget,
} from "@/lib/department-switcher-state";

export const READ_ONLY_BADGE = "โหมดดูทุกงาน (อ่านอย่างเดียว) — เลือกงานก่อนบันทึก";
export const LOAD_ERROR_TEXT = "โหลดรายการงานไม่สำเร็จ";
export const BUSY_TEXT = "กำลังสลับงาน…";

export function confirmMessage(label: string): string {
  return `สลับไปงาน ${label}? ข้อมูลที่ยังไม่บันทึกในหน้านี้จะหาย`;
}

const CARD = "flex flex-col gap-2 rounded-2xl border border-line bg-white p-3.5";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const BTN = `rounded-lg border px-3 py-1.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

function toValue(target: SwitchTarget): string {
  return target === "ALL" ? "ALL" : String(target);
}

function fromValue(value: string): SwitchTarget | null {
  if (value === "ALL") return "ALL";
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** Name of the current department (bold line above the select); the ALL view uses the ALL label. */
function currentName(ctx: DepartmentContext): string | null {
  if (ctx.active) return ctx.active.name;
  return ctx.scope === "ALL" ? ALL_LABEL : null;
}

export type DepartmentSwitcherViewProps = {
  ctx: DepartmentContext | null;
  state?: SwitcherState;
  /** One-shot message such as "สลับไปงาน X แล้ว" (auth-provider `departmentNotice`). */
  notice?: string | null;
  /** The "retry" button is waiting for the answer. */
  retrying?: boolean;
  /** Prefix for element ids (use a different one when two switchers are mounted). */
  idPrefix?: string;
  onSelect?: (target: SwitchTarget) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onFocusChange?: (focused: boolean) => void;
};

export function DepartmentSwitcherView({
  ctx,
  state = initialSwitcherState,
  notice = null,
  retrying = false,
  idPrefix = "department-switcher",
  onSelect,
  onConfirm,
  onCancel,
  onRetry,
  onFocusChange,
}: DepartmentSwitcherViewProps) {
  if (!ctx) return null;

  const name = currentName(ctx);
  const showSwitch = shouldShowSwitcher(ctx);
  const showLoadError = shouldShowLoadError(ctx);
  // List failed to load but the current department is known: keep showing its name (read-only) so nobody works in the wrong room.
  const showNameOnly = !showSwitch && !showLoadError && ctx.options === null && name !== null;
  // Solo user (nothing to switch to) and no problem to report -> render nothing.
  if (!showSwitch && !showLoadError && !showNameOnly) return null;

  const busy = state.phase === "busy";
  const choices = switcherChoices(ctx);
  const selectId = `${idPrefix}-select`;
  const dialogId = `${idPrefix}-dialog`;
  const pendingTarget = state.phase === "idle" ? null : state.target;
  const pendingLabel = pendingTarget === null ? "" : (choices.find((c) => c.target === pendingTarget)?.label ?? "ที่เลือก");

  return (
    <div className={CARD}>
      {notice && (
        <p role="status" className="text-xs text-gray-600">
          {notice}
        </p>
      )}

      {name !== null && (
        <div className="min-w-0">
          <p className="text-[11px] text-gray-600">งานที่ใช้อยู่</p>
          <p className="truncate text-sm font-bold text-ink" title={name}>
            {name}
          </p>
        </div>
      )}

      {ctx.readOnly && <p className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-ink">{READ_ONLY_BADGE}</p>}

      {showSwitch && (
        <>
          <label htmlFor={selectId} className="text-[11px] text-gray-600">
            สลับงาน
          </label>
          <select
            id={selectId}
            value={toValue(pendingTarget ?? ctx.scope)}
            disabled={busy}
            onChange={(e) => {
              const target = fromValue(e.target.value);
              if (target !== null) onSelect?.(target);
            }}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            className={`w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
          >
            {choices.map((c) => (
              <option key={toValue(c.target)} value={toValue(c.target)}>
                {c.label}
              </option>
            ))}
          </select>
        </>
      )}

      {showSwitch && state.phase !== "idle" && (
        <div
          id={dialogId}
          role="alertdialog"
          aria-labelledby={`${dialogId}-text`}
          className="flex flex-col gap-2 rounded-xl border border-line bg-gray-50 p-2.5"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) {
              // Only this panel handles Esc (the mobile drawer listens on document and skips defaultPrevented).
              e.preventDefault();
              e.stopPropagation();
              onCancel?.();
            }
          }}
        >
          <p id={`${dialogId}-text`} className="text-[13px] text-ink">
            {confirmMessage(pendingLabel)}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm?.()}
              className={`${BTN} border-accent bg-accent text-white`}
            >
              สลับงาน
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onCancel?.()}
              className={`${BTN} border-line bg-white text-ink`}
            >
              ยกเลิก
            </button>
          </div>
          {busy && (
            <p role="status" className="text-xs text-gray-600">
              {BUSY_TEXT}
            </p>
          )}
        </div>
      )}

      {state.phase === "idle" && state.error && (
        <div role="alert" className="text-xs text-crit">
          <p>{state.error.message}</p>
          {state.error.hint && <p className="text-gray-600">{state.error.hint}</p>}
        </div>
      )}

      {showLoadError && (
        <div role="alert" className="flex flex-col gap-1.5 text-xs text-crit">
          <p>{LOAD_ERROR_TEXT}</p>
          <button
            type="button"
            disabled={retrying}
            onClick={() => onRetry?.()}
            className={`${BTN} w-fit border-line bg-white text-ink`}
          >
            ลองใหม่
          </button>
        </div>
      )}
    </div>
  );
}

export type DepartmentSwitcherProps = {
  ctx: DepartmentContext | null;
  notice?: string | null;
  idPrefix?: string;
  /** POST succeeded: the caller stores the pending marker and reloads the page. */
  onSwitched?: (target: SwitchTarget) => void;
  /** 409 DEPARTMENTS_DISABLED: the caller hides the switcher (drops its departmentContext). */
  onDisabled?: () => void;
  /** Retry button. Default: fetchDepartmentContext(), answer passed to onContextLoaded (undefined = call failed, ignored). */
  onRetry?: () => Promise<unknown> | void;
  onContextLoaded?: (ctx: DepartmentContext | null) => void;
  /** true while the select has focus or a switch is confirming / busy (sidebar uses it to stay open). */
  onEngagedChange?: (engaged: boolean) => void;
};

export function DepartmentSwitcher({
  ctx,
  notice,
  idPrefix,
  onSwitched,
  onDisabled,
  onRetry,
  onContextLoaded,
  onEngagedChange,
}: DepartmentSwitcherProps) {
  const [state, dispatch] = useReducer(switcherReducer, initialSwitcherState);
  const [selectFocused, setSelectFocused] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const inflight = useRef(false);
  const mounted = useRef(true);
  // Latest callbacks, so effects do not re-run (and never double-send) when the parent re-renders.
  const cb = useRef({ onSwitched, onDisabled, onEngagedChange });
  useEffect(() => {
    cb.current = { onSwitched, onDisabled, onEngagedChange };
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The POST is sent here (never in the reducer). `inflight` keeps StrictMode / fast double clicks to one request.
  useEffect(() => {
    if (state.phase !== "busy" || inflight.current) return;
    inflight.current = true;
    const target = state.target;
    const fail = () => {
      if (mounted.current) dispatch({ type: "failed", error: { message: SWITCH_FALLBACK_MESSAGE, code: "SWITCH_CALLBACK_ERROR" } });
    };
    void switchDepartment(target)
      .then((outcome) => {
        inflight.current = false;
        try {
          if (outcome === "reload") {
            // stay busy on purpose: the caller reloads the page
            cb.current.onSwitched?.(target);
          } else if (outcome === "hide") {
            cb.current.onDisabled?.();
            if (mounted.current) dispatch({ type: "done" });
          } else if (mounted.current) {
            dispatch({ type: "failed", error: outcome.error });
          }
        } catch {
          fail();
        }
      })
      .catch(() => {
        inflight.current = false;
        fail();
      });
  }, [state]);

  // A failed switch keeps the sidebar open until the user picks again, so the message is not hidden by the collapsed rail.
  const engaged = isSwitcherEngaged(state, selectFocused) || (state.phase === "idle" && state.error !== null);
  useEffect(() => {
    cb.current.onEngagedChange?.(engaged);
  }, [engaged]);
  useEffect(() => {
    const latest = cb;
    return () => latest.current.onEngagedChange?.(false);
  }, []);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      if (onRetry) {
        await onRetry();
      } else {
        const next = await fetchDepartmentContext();
        if (next !== undefined) onContextLoaded?.(next);
      }
    } finally {
      if (mounted.current) setRetrying(false);
    }
  };

  return (
    <DepartmentSwitcherView
      ctx={ctx}
      state={state}
      notice={notice}
      retrying={retrying}
      idPrefix={idPrefix}
      onSelect={(target) => {
        if (ctx) dispatch({ type: "select", target, current: ctx.scope });
      }}
      onConfirm={() => dispatch({ type: "confirm" })}
      onCancel={() => dispatch({ type: "cancel" })}
      onRetry={handleRetry}
      onFocusChange={setSelectFocused}
    />
  );
}
