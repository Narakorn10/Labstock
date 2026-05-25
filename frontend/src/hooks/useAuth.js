import { useState, useEffect, useCallback } from 'react';
import { gasRun } from '../api';

const useAuth = (showToast) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('auth_token'));
    const [loading, setLoading] = useState(!!token);

    const logout = useCallback(async () => {
        if (token) gasRun('logout', token).catch(() => {});
        localStorage.removeItem('auth_token');
        setToken(null);
        setUser(null);
        showToast("ออกจากระบบแล้ว");
    }, [token, showToast]);

    const login = async (username, password) => {
        try {
            const res = await gasRun('login', username, password);
            if (res.success) {
                localStorage.setItem('auth_token', res.token);
                setToken(res.token);
                setUser(res.user);
                showToast(`ยินดีต้อนรับคุณ ${res.user.name}`);
                return { success: true };
            } else {
                showToast(res.message, 'error');
                return { success: false, message: res.message };
            }
        } catch (error) {
            showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", 'error');
            return { success: false, message: error.message };
        }
    };

    useEffect(() => {
        if (token && !user) {
            const validate = async () => {
                try {
                    const res = await gasRun('validateSession', token);
                    if (res.success) {
                        setUser(res.user);
                    } else {
                        localStorage.removeItem('auth_token');
                        setToken(null);
                        if (res.message) showToast(res.message, 'error');
                    }
                } catch (e) {
                    console.error("Auth validation failed", e);
                } finally {
                    setLoading(false);
                }
            };
            validate();
        } else {
            const clearLoading = async () => {
                setLoading(false);
            };
            clearLoading();
        }
    }, [token, user, showToast]);

    return { user, token, loading, login, logout };
};

export default useAuth;
