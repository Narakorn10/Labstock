/**
 * Robust barcode parser for Medical Laboratory Inventory Management.
 * Handles GS1-compliant (Clinical Reagents) and Standard 1D barcodes.
 * 
 * @param {string} rawBarcode - The raw scanned barcode string.
 * @returns {Object} Structured data containing gtin, lot, expDate, etc.
 */
export const processAnyBarcode = (rawBarcode) => {
    if (!rawBarcode) return null;

    // 1. Clean: Remove surrounding whitespace, AIM IDs (like ]C1, ]d2), parentheses, and spaces/newlines
    const cleanBarcode = rawBarcode.trim()
        .replace(/^\][a-zA-Z0-9]{2}/, "") 
        .replace(/[()]/g, "")             
        .replace(/\s/g, "");             

    // 2. Try Regex-based GS1 Extraction (Much more robust for multi-line labels)
    // We look for patterns: 01(14 digits), 17(6 digits), 10(variable length)
    const result = {
        barcodeType: "STANDARD_1D",
        gtin: "",
        ref: "NEED_MANUAL_INPUT",
        lot: "NEED_MANUAL_INPUT",
        expDate: "NEED_MANUAL_INPUT",
        mfgDate: "NEED_MANUAL_INPUT",
        rawString: cleanBarcode
    };

    // Extract GTIN (01) - 14 digits
    const gtinMatch = cleanBarcode.match(/01(\d{14})/);
    if (gtinMatch) {
        result.gtin = gtinMatch[1];
        result.barcodeType = "GS1_COMPLIANT";
    }

    // Extract EXP (17) - 6 digits
    const expMatch = cleanBarcode.match(/17(\d{6})/);
    if (expMatch) {
        result.expDate = formatGS1Date(expMatch[1]);
        result.barcodeType = "GS1_COMPLIANT";
    }

    // Extract Lot (10) - Up to 20 chars, usually until another AI or end of string
    // This is the trickiest part. We look for 10 followed by characters until we hit 
    // another fixed-length AI like 17 (if it exists later) or the end.
    const lotMatch = cleanBarcode.match(/10([a-zA-Z0-9]{1,20})/);
    if (lotMatch) {
        result.lot = lotMatch[1];
        result.barcodeType = "GS1_COMPLIANT";
    }

    // Extract MFG (11) - 6 digits
    const mfgMatch = cleanBarcode.match(/11(\d{6})/);
    if (mfgMatch) {
        result.mfgDate = formatGS1Date(mfgMatch[1]);
    }

    if (result.barcodeType === "GS1_COMPLIANT") {
        return result;
    }

    // Fallback for simple barcodes
    result.gtin = cleanBarcode;
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
