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
 * Utility: Parse GS1 Barcode/QR for GTIN, Lot, and Expiry
 * รองรับทั้งแบบมีวงเล็บ (01)GTIN(17)EXP(10)LOT และแบบ Raw 01GTIN17EXP10LOT
 */
export const decodeGS1 = (text) => {
    if (!text) return null;
    const res = { gtin: null, lot: null, exp: null };

    // 1. ตรวจสอบรูปแบบที่มีวงเล็บ (Common in standardized QR)
    const gtinP = text.match(/\(01\)(\d{14})/);
    const lotP = text.match(/\(10\)([^()]+)/);
    const expP = text.match(/\(17\)(\d{6})/);

    if (gtinP || lotP || expP) {
        if (gtinP) res.gtin = gtinP[1];
        if (lotP) res.lot = lotP[1].trim();
        if (expP) {
            const d = expP[1];
            res.exp = `20${d.substring(0, 2)}-${d.substring(2, 4)}-${d.substring(4, 6)}`;
        }
    } 
    // 2. ตรวจสอบรูปแบบ Raw (ไม่มีวงเล็บ) - มักเจอในเครื่องสแกนบาร์โค้ดทั่วไป
    else {
        // รูปแบบยอดนิยม: 01 (14 หลัก) + 17 (6 หลัก) + 10 (ที่เหลือคือ Lot)
        if (text.startsWith('01') && text.length >= 16) {
            res.gtin = text.substring(2, 16);
            
            // ค้นหา AI (17) สำหรับวันหมดอายุ
            const expIdx = text.indexOf('17', 16);
            if (expIdx !== -1 && expIdx + 8 <= text.length) {
                const datePart = text.substring(expIdx + 2, expIdx + 8);
                if (/^\d{6}$/.test(datePart)) {
                    res.exp = `20${datePart.substring(0, 2)}-${datePart.substring(2, 4)}-${datePart.substring(4, 6)}`;
                    
                    // ค้นหา AI (10) สำหรับ Lot หลังวันหมดอายุ
                    const lotIdx = text.indexOf('10', expIdx + 8);
                    if (lotIdx !== -1) {
                        res.lot = text.substring(lotIdx + 2);
                    }
                }
            } else {
                // ถ้าไม่เจอ 17 อาจจะเป็น 01 + 10 (Lot) เลย
                const lotIdx = text.indexOf('10', 16);
                if (lotIdx !== -1) {
                    res.lot = text.substring(lotIdx + 2);
                }
            }
        }
    }
    
    // ถ้าดึงข้อมูลไม่ได้เลย ให้คืนค่า null
    return (res.gtin || res.lot || res.exp) ? res : null;
};

// Keep for backward compatibility if needed by other parts, but use decodeGS1 primarily
export const parseGS1Lot = (text) => {
    const decoded = decodeGS1(text);
    return decoded ? decoded.lot : null;
};