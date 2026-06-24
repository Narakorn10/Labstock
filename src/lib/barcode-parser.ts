/**
 * Robust barcode parser for Medical Laboratory Inventory Management.
 * Handles GS1-compliant (Clinical Reagents) and Standard 1D barcodes.
 * 
 * Migrated from LabReagentControl (React) to LabStock (Next.js)
 */

import { BarcodePattern } from '@/lib/api-client';

export interface BarcodeData {
    barcodeType: "GS1_COMPLIANT" | "STANDARD_1D" | "CUSTOM_PATTERN";
    gtin: string;
    ref: string;
    lot: string;
    expDate: string;
    mfgDate: string;
    rawString: string;
}

interface ReagentLookupItem {
    itemId: string;
    qrCode?: string;
}

/**
 * Standardizes various date formats into YYYY-MM-DD
 * Supports: DDMMYYYY, YYYYMMDD, DDMMYY, YYMMDD, and separated formats
 */
export const standardizeDate = (dateStr: string): string => {
    if (!dateStr || dateStr === "NEED_MANUAL_INPUT") return dateStr;
    
    // Clean string (remove separators like / - . space)
    const clean = dateStr.replace(/[^0-9]/g, "");
    
    // 8 digits: YYYYMMDD or DDMMYYYY
    if (clean.length === 8) {
        // Check if starts with 19xx or 20xx (YYYYMMDD)
        if (clean.startsWith('20') || clean.startsWith('19')) {
            return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(6, 8)}`;
        }
        // Check if ends with 19xx or 20xx (DDMMYYYY)
        const year = clean.substring(4, 8);
        if (year.startsWith('20') || year.startsWith('19')) {
            return `${year}-${clean.substring(2, 4)}-${clean.substring(0, 2)}`;
        }
    }
    
    // 6 digits: YYMMDD (GS1) or DDMMYY
    if (clean.length === 6) {
        const p1 = parseInt(clean.substring(0, 2));
        const p2 = parseInt(clean.substring(2, 4)); // month?
        const p3 = parseInt(clean.substring(4, 6));

        // If p1 > 31, it must be YYMMDD
        // If p3 > 31, it must be DDMMYY
        // If both < 31, it's ambiguous, assume YYMMDD (GS1 standard)
        
        if (p1 > 31) {
            // YYMMDD
            const year = (p1 >= 70 ? "19" : "20") + clean.substring(0, 2);
            return `${year}-${clean.substring(2, 4)}-${clean.substring(4, 6)}`;
        } else if (p3 > 31) {
            // DDMMYY
            const year = (p3 >= 70 ? "19" : "20") + clean.substring(4, 6);
            return `${year}-${clean.substring(2, 4)}-${clean.substring(0, 2)}`;
        } else {
            // Ambiguous, assume YYMMDD (Standard GS1)
            const year = (p1 >= 70 ? "19" : "20") + clean.substring(0, 2);
            return `${year}-${clean.substring(2, 4)}-${clean.substring(4, 6)}`;
        }
    }

    return dateStr;
};

export const processAnyBarcode = (rawBarcode: string, patterns: BarcodePattern[] = []): BarcodeData | null => {
    if (!rawBarcode) return null;

    // 0. Test Custom Patterns First
    for (const pattern of patterns) {
        try {
            const regex = new RegExp(pattern.regex_pattern);
            const match = rawBarcode.match(regex);
            
            if (match) {
                return {
                    barcodeType: "CUSTOM_PATTERN",
                    gtin: pattern.item_id_group ? (match[pattern.item_id_group] || "") : rawBarcode,
                    ref: "NEED_MANUAL_INPUT",
                    lot: pattern.lot_no_group ? (match[pattern.lot_no_group] || "") : "NEED_MANUAL_INPUT",
                    expDate: pattern.exp_date_group ? standardizeDate(match[pattern.exp_date_group] || "") : "NEED_MANUAL_INPUT",
                    mfgDate: "NEED_MANUAL_INPUT",
                    rawString: rawBarcode
                };
            }
        } catch (e) {
            console.error("Invalid regex pattern from DB:", pattern.regex_pattern, e);
        }
    }

    // 1. Aggressive Clean
    let workingString = rawBarcode.trim()
        .replace(/^\][a-zA-Z0-9]{2}/, "") 
        .replace(/[()]/g, "")             
        .replace(/\s/g, "");             

    const result: BarcodeData = {
        barcodeType: "STANDARD_1D",
        gtin: "",
        ref: "NEED_MANUAL_INPUT",
        lot: "NEED_MANUAL_INPUT",
        expDate: "NEED_MANUAL_INPUT",
        mfgDate: "NEED_MANUAL_INPUT",
        rawString: workingString
    };

    // 2. High-Precision GS1 Consumption Logic
    let foundGS1 = false;

    // A. Consume GTIN (01) - Always 14 digits
    const gtinMatch = workingString.match(/01(\d{14})/);
    if (gtinMatch) {
        result.gtin = gtinMatch[1];
        workingString = workingString.replace(gtinMatch[0], ""); 
        foundGS1 = true;
    }

    // B. Consume EXP (17) - Always 6 digits
    const expMatch = workingString.match(/17(\d{6})/);
    if (expMatch) {
        result.expDate = formatGS1Date(expMatch[1]);
        workingString = workingString.replace(expMatch[0], ""); 
        foundGS1 = true;
    }

    // C. Consume MFG (11) - Always 6 digits
    const mfgMatch = workingString.match(/11(\d{6})/);
    if (mfgMatch) {
        result.mfgDate = formatGS1Date(mfgMatch[1]);
        workingString = workingString.replace(mfgMatch[0], ""); 
        foundGS1 = true;
    }

    // D. Extract Lot (10)
    const lotMatch = workingString.match(/10([a-zA-Z0-9]+)/);
    if (lotMatch) {
        result.lot = lotMatch[1];
        foundGS1 = true;
    } else if (workingString.length > 2 && foundGS1) {
        result.lot = workingString;
        foundGS1 = true;
    }

    if (foundGS1) {
        result.barcodeType = "GS1_COMPLIANT";
        return result;
    }

    // Fallback for simple barcodes
    result.gtin = rawBarcode.trim();
    return result;
};

export const normalizeLookupValue = (value: string | null | undefined): string => {
    if (!value) return "";

    return value
        .trim()
        .replace(/^\][a-zA-Z0-9]{2}/, "")
        .replace(/[()\s./-]/g, "")
        .replace(/^0+/, "")
        .toLowerCase();
};

export const findMatchingReagent = <T extends ReagentLookupItem>(
    rawBarcode: string,
    patterns: BarcodePattern[] = [],
    reagents: T[] = []
): { data: BarcodeData | null; match: T | undefined; lookupValues: string[] } => {
    const data = processAnyBarcode(rawBarcode, patterns);
    if (!data) {
        return { data: null, match: undefined, lookupValues: [] };
    }

    const lookupKeys = new Set([
        normalizeLookupValue(rawBarcode),
        normalizeLookupValue(data.gtin),
        normalizeLookupValue(data.rawString),
    ].filter(Boolean));

    const exactMatch = reagents.find((reagent) => {
        const itemId = normalizeLookupValue(reagent.itemId);
        const qrCode = normalizeLookupValue(reagent.qrCode);

        return lookupKeys.has(itemId) || lookupKeys.has(qrCode);
    });

    if (exactMatch) {
        return { data, match: exactMatch, lookupValues: Array.from(lookupKeys) };
    }

    const looseMatch = reagents.find((reagent) => {
        const candidates = [
            normalizeLookupValue(reagent.itemId),
            normalizeLookupValue(reagent.qrCode),
        ].filter((value) => value.length >= 6);

        return Array.from(lookupKeys).some((key) => (
            key.length >= 6 &&
            candidates.some((candidate) => candidate.includes(key) || key.includes(candidate))
        ));
    });

    return { data, match: looseMatch, lookupValues: Array.from(lookupKeys) };
};

const formatGS1Date = (yymmdd: string): string => {
    if (!yymmdd || yymmdd.length !== 6) return "INVALID_DATE";
    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const year = (yy >= 70 ? "19" : "20") + yymmdd.substring(0, 2);
    const month = yymmdd.substring(2, 4);
    const day = yymmdd.substring(4, 6);
    return `${year}-${month}-${day}`;
};
