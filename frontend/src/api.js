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
 */
export const decodeGS1 = (text) => {
    if(!text) return null;
    const res = { gtin: null, lot: null, exp: null };
    
    // Support formats like (01)123(17)YYMMDD(10)LOT
    // Or plain strings with GS1 AI prefixes
    
    // 1. Extract GTIN (01) - usually 14 digits
    const gtinMatch = text.match(/\(01\)(\d{14})/);
    if(gtinMatch) res.gtin = gtinMatch[1];
    
    // 2. Extract Lot (10) - variable length
    const lotMatch = text.match(/\(10\)([^()]+)/);
    if(lotMatch) res.lot = lotMatch[1].trim();
    
    // 3. Extract Expiry (17) - 6 digits (YYMMDD)
    const expMatch = text.match(/\(17\)(\d{6})/);
    if(expMatch) {
        const yy = expMatch[1].substring(0, 2);
        const mm = expMatch[1].substring(2, 4);
        const dd = expMatch[1].substring(4, 6);
        // Convert YYMMDD to YYYY-MM-DD
        res.exp = `20${yy}-${mm}-${dd}`;
    }

    // Fallback for codes without parentheses if they follow standard fixed lengths
    if (!res.gtin && !res.lot && !res.exp) {
        // Very basic heuristic for some common reagent barcodes
        if (text.startsWith('01') && text.length >= 16) {
             res.gtin = text.substring(2, 16);
             // This gets complex without delimiters, but let's stick to (AI) format for now as it's standard for GS1 QR
        }
    }
    
    return res;
};

// Keep for backward compatibility if needed by other parts, but use decodeGS1 primarily
export const parseGS1Lot = (text) => {
    const decoded = decodeGS1(text);
    return decoded ? decoded.lot : null;
};