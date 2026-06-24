/**
 * Robust barcode parser for Medical Laboratory Inventory Management.
 * Handles GS1-compliant (Clinical Reagents) and Standard 1D barcodes.
 * 
 * Migrated from LabReagentControl (React) to LabStock (Next.js)
 */

import type { BarcodePattern } from '@/lib/api-client';

export interface BarcodeData {
    barcodeType: "GS1_COMPLIANT" | "STANDARD_1D" | "CUSTOM_PATTERN";
    gtin: string;
    udi: string;
    ref: string;
    lot: string;
    expDate: string;
    mfgDate: string;
    serial: string;
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

const parseCustomPattern = (
    rawBarcode: string,
    pattern: BarcodePattern,
    reportInvalidPattern = true
): BarcodeData | null => {
    try {
        const regex = new RegExp(pattern.regex_pattern);
        const match = rawBarcode.match(regex);
        if (!match) return null;

        return {
            barcodeType: "CUSTOM_PATTERN",
            gtin: pattern.item_id_group ? (match[pattern.item_id_group] || "") : rawBarcode,
            udi: rawBarcode,
            ref: "NEED_MANUAL_INPUT",
            lot: pattern.lot_no_group ? (match[pattern.lot_no_group] || "") : "NEED_MANUAL_INPUT",
            expDate: pattern.exp_date_group ? standardizeDate(match[pattern.exp_date_group] || "") : "NEED_MANUAL_INPUT",
            mfgDate: "NEED_MANUAL_INPUT",
            serial: "NEED_MANUAL_INPUT",
            rawString: rawBarcode
        };
    } catch (error) {
        if (reportInvalidPattern) {
            console.error("Invalid regex pattern from DB:", pattern.regex_pattern, error);
        }
        return null;
    }
};

export const processAnyBarcode = (rawBarcode: string, patterns: BarcodePattern[] = []): BarcodeData | null => {
    if (!rawBarcode) return null;

    // A valid GS1 UDI must take precedence over broad positional patterns.
    const gs1Data = parseGs1Udi(rawBarcode);
    if (gs1Data) return gs1Data;

    // Test vendor-specific patterns after standards-based parsing.
    for (const pattern of patterns) {
        const data = parseCustomPattern(rawBarcode, pattern);
        if (data) return data;
    }

    // 1. Aggressive Clean
    const workingString = rawBarcode.trim()
        .replace(/^\][a-zA-Z0-9]{2}/, "") 
        .replace(/[()]/g, "")             
        .replace(/\s/g, "");             

    const result: BarcodeData = {
        barcodeType: "STANDARD_1D",
        gtin: "",
        udi: rawBarcode.trim(),
        ref: "NEED_MANUAL_INPUT",
        lot: "NEED_MANUAL_INPUT",
        expDate: "NEED_MANUAL_INPUT",
        mfgDate: "NEED_MANUAL_INPUT",
        serial: "NEED_MANUAL_INPUT",
        rawString: workingString
    };

    // Fallback for simple barcodes
    result.gtin = rawBarcode.trim();
    return result;
};

export const normalizeLookupValue = (value: string | null | undefined): string => {
    if (!value) return "";

    return value
        .trim()
        .replace(/^\][a-zA-Z0-9]{2}/, "")
        // Scanners may preserve FNC1/control characters and vendor separators.
        .replace(/[^a-zA-Z0-9]/g, "")
        .replace(/^0+/, "")
        .toLowerCase();
};

const getLookupValues = (
    rawBarcode: string,
    data: BarcodeData,
    patterns: BarcodePattern[]
): string[] => {
    const values = new Set<string>();
    const addValue = (value: string | null | undefined) => {
        const normalized = normalizeLookupValue(value);
        if (normalized) values.add(normalized);
    };

    addValue(rawBarcode);
    addValue(data.gtin);
    addValue(data.rawString);

    // A GS1 payload identifies the product with AI (01), followed by a 14-digit GTIN.
    for (const match of rawBarcode.matchAll(/(?:\(01\)|01)(\d{14})/g)) {
        addValue(match[1]);
    }

    // Patterns can overlap. Collect every configured item group instead of trusting
    // only the first pattern selected by processAnyBarcode().
    for (const pattern of patterns) {
        if (!pattern.item_id_group) continue;

        try {
            const regex = new RegExp(pattern.regex_pattern);
            const match = rawBarcode.match(regex);
            if (match) addValue(match[pattern.item_id_group]);
        } catch {
            // Invalid patterns are reported by processAnyBarcode; skip them here.
        }
    }

    return Array.from(values);
};

const getReagentCodeMatchScore = (
    value: string,
    reagent: ReagentLookupItem
): number => {
    const key = normalizeLookupValue(value);
    if (!key) return 0;

    const candidates = [
        normalizeLookupValue(reagent.itemId),
        normalizeLookupValue(reagent.qrCode),
    ].filter(Boolean);

    if (candidates.some((candidate) => candidate === key)) return 2;

    return candidates.some((candidate) => (
        candidate.length >= 6 && key.length >= 6 && (
            candidate.includes(key) || key.includes(candidate)
        )
    )) ? 1 : 0;
};

const resolveBarcodeData = (
    rawBarcode: string,
    patterns: BarcodePattern[],
    reagent: ReagentLookupItem,
    fallback: BarcodeData
): BarcodeData => {
    let resolvedData = fallback;
    let resolvedScore = 0;

    for (const pattern of patterns) {
        const patternData = parseCustomPattern(rawBarcode, pattern, false);
        if (!patternData) continue;

        const score = getReagentCodeMatchScore(patternData.gtin, reagent);
        if (score > resolvedScore) {
            resolvedData = patternData;
            resolvedScore = score;
        }
    }

    // A broad custom regex can match an unrelated GS1 payload. Prefer the GS1
    // interpretation when its GTIN is the code that identified the reagent.
    const standardData = processAnyBarcode(rawBarcode, []);
    if (standardData) {
        const score = getReagentCodeMatchScore(standardData.gtin, reagent);
        if (score > resolvedScore) {
            resolvedData = standardData;
        }
    }

    return resolvedData;
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

    const lookupValues = getLookupValues(rawBarcode, data, patterns);
    const lookupKeys = new Set(lookupValues);

    const exactMatch = reagents.find((reagent) => {
        const itemId = normalizeLookupValue(reagent.itemId);
        const qrCode = normalizeLookupValue(reagent.qrCode);

        return lookupKeys.has(itemId) || lookupKeys.has(qrCode);
    });

    if (exactMatch) {
        return {
            data: resolveBarcodeData(rawBarcode, patterns, exactMatch, data),
            match: exactMatch,
            lookupValues
        };
    }

    const looseMatch = reagents.find((reagent) => {
        const candidates = [
            normalizeLookupValue(reagent.itemId),
            normalizeLookupValue(reagent.qrCode),
        ].filter((value) => value.length >= 6);

        return lookupValues.some((key) => (
            key.length >= 6 &&
            candidates.some((candidate) => candidate.includes(key) || key.includes(candidate))
        ));
    });

    return {
        data: looseMatch ? resolveBarcodeData(rawBarcode, patterns, looseMatch, data) : data,
        match: looseMatch,
        lookupValues
    };
};

const formatGS1Date = (yymmdd: string): string => {
    if (!yymmdd || yymmdd.length !== 6) return "INVALID_DATE";
    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const year = (yy >= 70 ? "19" : "20") + yymmdd.substring(0, 2);
    const month = yymmdd.substring(2, 4);
    const day = yymmdd.substring(4, 6);
    return `${year}-${month}-${day}`;
};

const parseGs1Udi = (rawBarcode: string): BarcodeData | null => {
    const elements = new Map<string, string>();
    const supportedAis = new Set(['01', '10', '11', '17', '21']);
    const addElement = (ai: string, value: string | undefined) => {
        const cleanValue = value?.trim();
        if (cleanValue && supportedAis.has(ai) && !elements.has(ai)) {
            elements.set(ai, cleanValue);
        }
    };

    // Human-readable GS1: (01)GTIN(17)YYMMDD(10)LOT(21)SERIAL
    for (const match of rawBarcode.matchAll(/\((01|10|11|17|21)\)([^()]*)/g)) {
        addElement(match[1], match[2]);
    }

    // GS1 Digital Link: /01/GTIN/10/LOT?17=YYMMDD
    try {
        const url = new URL(rawBarcode);
        const parts = url.pathname.split('/').filter(Boolean);
        for (let index = 0; index < parts.length - 1; index += 1) {
            if (supportedAis.has(parts[index])) {
                addElement(parts[index], decodeURIComponent(parts[index + 1]));
                index += 1;
            }
        }
        for (const ai of supportedAis) addElement(ai, url.searchParams.get(ai) || undefined);
    } catch {
        // Scanner payloads are usually compact GS1 strings rather than URLs.
    }

    // Scanner form: ]d2 + compact AIs, with ASCII 29 (FNC1) after variable fields.
    const compact = rawBarcode.trim()
        .replace(/^\][a-zA-Z0-9]{2}/, '')
        .replace(/\((01|10|11|17|21)\)/g, '$1')
        .replace(/\s/g, '');

    for (const segment of compact.split(/\x1D|<GS>|\|/i)) {
        let cursor = 0;
        while (cursor < segment.length) {
            const ai = segment.substring(cursor, cursor + 2);
            if (ai === '01' && /^\d{14}$/.test(segment.substring(cursor + 2, cursor + 16))) {
                addElement(ai, segment.substring(cursor + 2, cursor + 16));
                cursor += 16;
            } else if ((ai === '11' || ai === '17') && /^\d{6}$/.test(segment.substring(cursor + 2, cursor + 8))) {
                addElement(ai, segment.substring(cursor + 2, cursor + 8));
                cursor += 8;
            } else if (ai === '10' || ai === '21') {
                addElement(ai, segment.substring(cursor + 2));
                break;
            } else {
                break;
            }
        }
    }

    const gtin = elements.get('01');
    if (!gtin) return null;

    const canonicalUdi = ['01', '17', '11', '10', '21']
        .flatMap((ai) => elements.has(ai) ? [`(${ai})${elements.get(ai)}`] : [])
        .join('');
    const serial = elements.get('21') || 'NEED_MANUAL_INPUT';

    return {
        barcodeType: "GS1_COMPLIANT",
        gtin,
        udi: canonicalUdi,
        ref: serial,
        lot: elements.get('10') || 'NEED_MANUAL_INPUT',
        expDate: elements.has('17') ? formatGS1Date(elements.get('17') || '') : 'NEED_MANUAL_INPUT',
        mfgDate: elements.has('11') ? formatGS1Date(elements.get('11') || '') : 'NEED_MANUAL_INPUT',
        serial,
        rawString: rawBarcode
    };
};
