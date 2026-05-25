import { handleMockCall } from './api.mock';
import { processAnyBarcode } from './utils/barcodeParser';

/**
 * 🚀 Main API Bridge to Google Apps Script
 */
export const gasRun = (method, ...args) => {
    const token = localStorage.getItem('auth_token');
    
    return new Promise((resolve, reject) => {
        // 1. Try native Google Script Run (if running inside GAS iframe)
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(resolve)
                .withFailureHandler(reject)[method](...args, token); // Pass token as last arg for GAS native
            return;
        }

        // 2. Try External Fetch (if running on Vercel/Local with URL)
        const gasUrl = import.meta.env.VITE_GAS_URL;
        if (gasUrl) {
            fetch(gasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ method, args, token })
            })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
                return res.json();
            })
            .then(resolve)
            .catch(err => {
                console.error("❌ GAS Connection Error:", err);
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
 * Utility: Parse Barcode/QR using the robust processAnyBarcode logic.
 * Maintained for backward compatibility but enhanced with new parser.
 */
export const decodeGS1 = (text) => {
    const result = processAnyBarcode(text);
    // If not a GS1 barcode or invalid, we return null to signal standard processing
    if (!result || result.barcodeType !== "GS1_COMPLIANT") return null;
    
    return {
        gtin: result.gtin,
        lot: result.lot,
        exp: result.expDate
    };
};

// Keep for backward compatibility if needed by other parts
export const parseGS1Lot = (text) => {
    const decoded = decodeGS1(text);
    return decoded ? decoded.lot : null;
};

export { processAnyBarcode };