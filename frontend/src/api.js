import { handleMockCall } from './api.mock';

/**
 * 🚀 Main API Bridge to Google Apps Script
 */
export const gasRun = (method, ...args) => {
    return new Promise((resolve, reject) => {
        // 1. Try native Google Script Run (if running inside GAS iframe)
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(resolve)
                .withFailureHandler(reject)[method](...args);
            return;
        }

        // 2. Try External Fetch (if running on Vercel/Local with URL)
        const gasUrl = import.meta.env.VITE_GAS_URL;
        if (gasUrl) {
            fetch(gasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ method, args })
            })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
                return res.json();
            })
            .then(resolve)
            .catch(err => {
                console.error("❌ GAS Connection Error:", err);
                // alert("ไม่สามารถเชื่อมต่อ Google Sheets ได้\nกรุณาตรวจสอบการตั้งค่า VITE_GAS_URL");
                reject(err);
            });
            return;
        }

        // 3. Fallback to Mock Data (Development Mode ONLY)
        if (import.meta.env.DEV) {
            handleMockCall(method, args).then(resolve);
        } else {
            // Safety: In production, if no URL is provided, fail instead of showing fake data
            reject(new Error("Missing VITE_GAS_URL in Production environment"));
        }
    });
};

/**
 * Utility: Parse GS1 Barcode for Lot Number
 */
export const parseGS1Lot = (text) => {
    if(!text) return null;
    const match = text.match(/\(10\)([^()]+)/);
    return match ? match[1].trim() : null;
};