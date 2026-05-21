/**
 * Robust barcode parser for Medical Laboratory Inventory Management.
 * Handles GS1-compliant (Clinical Reagents) and Standard 1D barcodes.
 * 
 * @param {string} rawBarcode - The raw scanned barcode string.
 * @returns {Object} Structured data containing gtin, lot, expDate, etc.
 */
export const processAnyBarcode = (rawBarcode) => {
    if (!rawBarcode) return null;

    // 1. Aggressive Clean: Remove AIM IDs, parentheses, spaces, and newlines
    const raw = rawBarcode.trim()
        .replace(/^\][a-zA-Z0-9]{2}/, "") 
        .replace(/[()]/g, "")             
        .replace(/\s/g, "");             

    const result = {
        barcodeType: "STANDARD_1D",
        gtin: "",
        ref: "NEED_MANUAL_INPUT",
        lot: "NEED_MANUAL_INPUT",
        expDate: "NEED_MANUAL_INPUT",
        mfgDate: "NEED_MANUAL_INPUT",
        rawString: raw
    };

    // 2. Sequential Pointer Parser (Industry Standard for GS1)
    let i = 0;
    let foundGS1 = false;

    while (i < raw.length) {
        const ai2 = raw.substring(i, i + 2);
        const ai3 = raw.substring(i, i + 3);

        // (01) GTIN - 14 digits
        if (ai2 === "01") {
            result.gtin = raw.substring(i + 2, i + 16);
            i += 16;
            foundGS1 = true;
        } 
        // (17) EXP - 6 digits (YYMMDD)
        else if (ai2 === "17") {
            result.expDate = formatGS1Date(raw.substring(i + 2, i + 8));
            i += 8;
            foundGS1 = true;
        } 
        // (11) MFG - 6 digits (YYMMDD)
        else if (ai2 === "11") {
            result.mfgDate = formatGS1Date(raw.substring(i + 2, i + 8));
            i += 8;
            foundGS1 = true;
        } 
        // (10) Lot - Variable length (Usually to the end in clinical reagents)
        else if (ai2 === "10") {
            // Take the rest of the string as the Lot
            result.lot = raw.substring(i + 2);
            i = raw.length; // Consume everything
            foundGS1 = true;
        }
        // (240) REF - Optional
        else if (ai3 === "240") {
            result.ref = raw.substring(i + 3, i + 13); // Simple 10-char take
            i = raw.length; 
            foundGS1 = true;
        }
        else {
            // Move pointer forward if no AI matches to prevent infinite loop
            i++;
        }
    }

    if (foundGS1) {
        result.barcodeType = "GS1_COMPLIANT";
        return result;
    }

    // Fallback for simple barcodes (EAN, Code 128, etc.)
    result.gtin = raw;
    return result;
};

/**
 * Converts GS1 Date format (YYMMDD) to ISO format (YYYY-MM-DD).
 */
const formatGS1Date = (yymmdd) => {
    if (!yymmdd || yymmdd.length !== 6) return "INVALID_DATE";
    const year = "20" + yymmdd.substring(0, 2);
    const month = yymmdd.substring(2, 4);
    const day = yymmdd.substring(4, 6);
    return `${year}-${month}-${day}`;
};
