'use client';

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { SessionProvider, signIn, signOut, useSession } from 'next-auth/react';

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
}

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
        if (!response.ok && !cancelled) {
          clearStoredAuth();
          await signOut({ redirect: false });
          router.replace('/login');
          return;
        }
        if (response.ok && !cancelled) {
          const data = await response.json() as { user?: { department?: string | null } };
          setDepartment(data.user?.department ?? null);
        }
      } catch {
        // Keep an already-established session during a transient network failure.
      }
    };

    void verifyCurrentSession();
    return () => { cancelled = true; };
  }, [clearStoredAuth, loading, router, username]);

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
    <AuthContext.Provider value={{ user, login, logout, loading, isAuthorized }}>
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
