import { useState, useEffect } from 'react';
import { gasRun } from '../api';

const useGlobalData = () => {
    // 🚀 [Performance Boost] ใช้ข้อมูลที่ฉีดมาจาก Server ทันทีถ้ามี
    const [settings, setSettings] = useState(window.INITIAL_DATA?.settings || { reagentTypes: [], jobTypes: [], machineTypes: [] });
    const [activeDashboard, setActiveDashboard] = useState(window.INITIAL_DATA?.dashboard || []);

    const loadGlobalData = async () => {
        const [setRes, dashRes] = await Promise.all([gasRun('getSettings'), gasRun('getDashboardData')]);
        setSettings(setRes); 
        setActiveDashboard(dashRes);
    };

    // ไม่ต้องรัน loadGlobalData ใน useEffect ครั้งแรกถ้ามีข้อมูลแล้ว
    useEffect(() => { 
        if (!window.INITIAL_DATA?.success) {
            const fetchData = async () => {
                await loadGlobalData();
            };
            fetchData();
        }
    }, []);

    return { settings, activeDashboard, setActiveDashboard, loadGlobalData };
};

export default useGlobalData;
