'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface User {
  username: string;
  name: string;
  role: string;
  vendor?: string;
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

function readStoredUser() {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem('labstock_user');
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as User;
  } catch {
    localStorage.removeItem('labstock_user');
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStoredUser());
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const isPublicPath = pathname === '/login' || pathname.startsWith('/mobile');

  const clearStoredAuth = React.useCallback(() => {
    localStorage.removeItem('labstock_user');
    localStorage.removeItem('labstock_token');
  }, []);

  const logout = React.useCallback(() => {
    setUser(null);
    clearStoredAuth();
    router.push('/login');
  }, [clearStoredAuth, router]);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('labstock_token');

      if (!token) {
        clearStoredAuth();
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          localStorage.setItem('labstock_user', JSON.stringify(data.user));
        } else {
          clearStoredAuth();
          setUser(null);
        }
      } catch (error) {
        console.error('Auth verification failed:', error);
        clearStoredAuth();
        setUser(null);
      }

      setLoading(false);
    };

    checkAuth();
  }, [clearStoredAuth, isPublicPath, router]);

  useEffect(() => {
    if (!loading && !user && !isPublicPath) {
      router.push('/login');
    }
  }, [user, loading, isPublicPath, router]);

  const login = async (credentials: Partial<User>) => {
    const res = await apiClient.login(credentials);
    if (res.success && res.user && res.token) {
      setUser(res.user);
      localStorage.setItem('labstock_user', JSON.stringify(res.user));
      localStorage.setItem('labstock_token', res.token);
      router.push('/');
    }
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
