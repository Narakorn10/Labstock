'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface User {
  username: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  login: (credentials: any) => Promise<void>;
  logout: () => void;
  loading: boolean;
  isAuthorized: (allowedRoles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const logout = React.useCallback(() => {
    setUser(null);
    localStorage.removeItem('labstock_user');
    localStorage.removeItem('labstock_token');
    router.push('/login');
  }, [router]);

  useEffect(() => {
    const checkAuth = async () => {
      const savedUser = localStorage.getItem('labstock_user');
      const token = localStorage.getItem('labstock_token');
      
      if (savedUser && token) {
        try {
          const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (res.ok) {
            const data = await res.json();
            setUser(data.user);
            localStorage.setItem('labstock_user', JSON.stringify(data.user));
          } else {
            logout();
          }
        } catch (error) {
          console.error('Auth verification failed:', error);
          setUser(JSON.parse(savedUser));
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, [logout]);

  useEffect(() => {
    if (!loading && !user && pathname !== '/login') {
      router.push('/login');
    }
  }, [user, loading, pathname, router]);

  const login = async (credentials: any) => {
    const res = await apiClient.login(credentials);
    if (res.success) {
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
