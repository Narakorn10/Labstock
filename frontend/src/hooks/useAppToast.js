import { useState, useCallback } from 'react';

const useAppToast = () => {
    const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
    const showToast = useCallback((msg, type = 'success') => {
        setToast({ show: true, msg, type });
        setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    }, []);
    return { toast, showToast };
};

export default useAppToast;
