'use client';

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { SessionProvider, signIn, signOut, useSession } from 'next-auth/react';
import { fetchDepartmentContext } from '@/lib/department-session-client';
import {
  ALL_LABEL,
  PENDING_KEY,
  checkPendingSwitch,
  interpretMeResponse,
  makePending,
  type DepartmentContext,
  type SwitchTarget,
} from '@/lib/department-switcher-state';

interface User {
  username: string;
  name: string;
  role: string;
  vendor?: string;
  department?: string | null;
  password?: string;
}

interface AuthContextType {
  user: User | null;
  login: (credentials: Partial<User>) => Promise<void>;
  logout: () => void;
  loading: boolean;
  isAuthorized: (allowedRoles: string[]) => boolean;
  // Department switcher (optional): undefined / null when the departments flag is off.
  departmentContext?: DepartmentContext | null;
  /** One-shot message after a successful switch + reload. */
  departmentNotice?: string | null;
  /** Set when the pending switch did not land after the reload. */
  departmentError?: string | null;
  onDepartmentSwitched?: (target: SwitchTarget) => void;
  onDepartmentDisabled?: () => void;
  refreshDepartmentContext?: () => Promise<void>;
}

interface DepartmentState {
  owner: string | null;
  ctx: DepartmentContext | null;
  notice: string | null;
  error: string | null;
}

const EMPTY_DEPARTMENT_STATE: DepartmentState = { owner: null, ctx: null, notice: null, error: null };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider><AuthStateProvider>{children}</AuthStateProvider></SessionProvider>;
}

function AuthStateProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicPath = pathname === '/' || pathname === '/login' || pathname === '/register' || pathname.startsWith('/mobile') || pathname.startsWith('/liff');
  const [department, setDepartment] = React.useState<string | null>(null);
  const user = useMemo(() => {
    const sessionUser = session?.user as (User & { username?: string; role?: string; vendor?: string }) | undefined;
    return sessionUser?.username && sessionUser.role
      ? { username: sessionUser.username, name: sessionUser.name || sessionUser.username, role: sessionUser.role, vendor: sessionUser.vendor, department }
      : null;
  }, [session?.user, department]);
  const loading = status === 'loading';
  const username = user?.username;
  // Kept apart from the `user` memo on purpose: it must not change `user` (sidebar reloads its menu when `user` changes).
  const [deptState, setDeptState] = React.useState<DepartmentState>(EMPTY_DEPARTMENT_STATE);
  // A different signed-in user never sees the previous user's department state.
  const dept = deptState.owner === username ? deptState : EMPTY_DEPARTMENT_STATE;
  // Signed out (logout / expired session): drop the old department state so the next login in this tab starts clean.
  // Adjusted during render (not in an effect); the guard makes it a one-time reset, no loop.
  if (!loading && !username && deptState !== EMPTY_DEPARTMENT_STATE) setDeptState(EMPTY_DEPARTMENT_STATE);

  const clearStoredAuth = React.useCallback(() => {
    localStorage.removeItem('labstock_user');
    localStorage.removeItem('labstock_token');
  }, []);

  const logout = React.useCallback(async () => {
    clearStoredAuth();
    await signOut({ redirect: false });
    router.push('/login');
  }, [clearStoredAuth, router]);

  useEffect(() => {
    if (!loading && !user && !isPublicPath) {
      router.push('/login');
    }
  }, [user, loading, isPublicPath, router]);

  useEffect(() => {
    if (loading || !username) return;
    let cancelled = false;

    const verifyCurrentSession = async () => {
      try {
        const response = await fetch('/api/auth/me');
        // interpretMeResponse: any non-ok answer (401, 500, ...) -> signOut, exactly as before.
        const result = interpretMeResponse(response.ok, response.ok ? await response.json() : null);
        if (result.signOut && !cancelled) {
          try {
            sessionStorage.removeItem(PENDING_KEY);
          } catch {
            // sessionStorage unavailable: nothing to clear.
          }
          clearStoredAuth();
          await signOut({ redirect: false });
          router.replace('/login');
          return;
        }
        if (!result.signOut && !cancelled) {
          setDepartment(result.department);
          let pending: string | null = null;
          try {
            pending = sessionStorage.getItem(PENDING_KEY);
            if (pending !== null) sessionStorage.removeItem(PENDING_KEY);
          } catch {
            // sessionStorage unavailable: no pending check.
          }
          const pendingResult = checkPendingSwitch(pending, result.ctx, Date.now());
          setDeptState((prev) => ({
            owner: username,
            ctx: result.ctx,
            // Keep the one-shot message / error across a later re-run of this effect; replace only on a new result.
            notice: pendingResult === 'ok' ? `สลับไปงาน ${result.ctx?.active?.name ?? ALL_LABEL} แล้ว` : (prev.owner === username ? prev.notice : null),
            error: pendingResult === 'failed' ? 'สลับงานไม่สำเร็จ' : (prev.owner === username ? prev.error : null),
          }));
        }
      } catch {
        // Keep an already-established session during a transient network failure.
      }
    };

    void verifyCurrentSession();
    return () => { cancelled = true; };
  }, [clearStoredAuth, loading, router, username]);

  // The switch POST succeeded: remember the target for the post-reload check, then reload the whole page.
  const onDepartmentSwitched = React.useCallback((target: SwitchTarget) => {
    try {
      sessionStorage.setItem(PENDING_KEY, makePending(target, Date.now()));
    } catch {
      // sessionStorage unavailable: reload anyway, only the post-reload check is lost.
    }
    window.location.reload();
  }, []);

  // 409 DEPARTMENTS_DISABLED: the flag was turned off, hide the switcher.
  const onDepartmentDisabled = React.useCallback(() => {
    setDeptState((prev) => ({ ...prev, ctx: null }));
  }, []);

  // "Retry" button: no signOut path, a failed call keeps what is already shown.
  const refreshDepartmentContext = React.useCallback(async () => {
    const next = await fetchDepartmentContext();
    if (next === undefined || !username) return;
    setDeptState((prev) => ({ ...(prev.owner === username ? prev : EMPTY_DEPARTMENT_STATE), owner: username, ctx: next }));
  }, [username]);

  const login = async (credentials: Partial<User>) => {
    const result = await signIn('credentials', {
      redirect: false,
      username: credentials.username,
      password: credentials.password,
    });
    if (!result || result.error) {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชียังไม่ได้รับอนุมัติ');
    }
    clearStoredAuth();
    router.push('/dashboard');
  };

  const isAuthorized = (allowedRoles: string[]) => {
    if (!user) return false;
    return allowedRoles.includes(user.role);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        loading,
        isAuthorized,
        departmentContext: dept.ctx,
        departmentNotice: dept.notice,
        departmentError: dept.error,
        onDepartmentSwitched,
        onDepartmentDisabled,
        refreshDepartmentContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
