/**
 * Robust barcode parser for Medical Laboratory Inventory Management.
 * Handles GS1-compliant (Clinical Reagents) and Standard 1D barcodes.
 * 
 * @param {string} rawBarcode - The raw scanned barcode string.
 * @returns {Object} Structured data containing gtin, lot, expDate, etc.
 */
export const processAnyBarcode = (rawBarcode) => {
    if (!rawBarcode) return null;

    // 1. Aggressive Clean
    let workingString = rawBarcode.trim()
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
        rawString: workingString
    };

    // 2. High-Precision GS1 Consumption Logic
    // We search and "CUT" known fixed-length patterns out of the string one by one
    let foundGS1 = false;

    // A. Consume GTIN (01) - Always 14 digits
    const gtinMatch = workingString.match(/01(\d{14})/);
    if (gtinMatch) {
        result.gtin = gtinMatch[1];
        workingString = workingString.replace(gtinMatch[0], ""); // Remove it
        foundGS1 = true;
    }

    // B. Consume EXP (17) - Always 6 digits
    const expMatch = workingString.match(/17(\d{6})/);
    if (expMatch) {
        result.expDate = formatGS1Date(expMatch[1]);
        workingString = workingString.replace(expMatch[0], ""); // Remove it
        foundGS1 = true;
    }

    // C. Consume MFG (11) - Always 6 digits
    const mfgMatch = workingString.match(/11(\d{6})/);
    if (mfgMatch) {
        result.mfgDate = formatGS1Date(mfgMatch[1]);
        workingString = workingString.replace(mfgMatch[0], ""); // Remove it
        foundGS1 = true;
    }

    // D. Extract Lot (10) - Whatever is left after removing fixed fields
    // Many scanners/labels put Lot at the end or preceded by '10'
    const lotMatch = workingString.match(/10([a-zA-Z0-9]+)/);
    if (lotMatch) {
        result.lot = lotMatch[1];
        foundGS1 = true;
    } else if (workingString.length > 2) {
        // Fallback: If no '10' header but something is left, it's likely the Lot
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

/**
 * Converts GS1 Date format (YYMMDD) to ISO format (YYYY-MM-DD).
 * Handles the GS1 year rollover (70-99 = 19xx, 00-69 = 20xx)
 */
const formatGS1Date = (yymmdd) => {
    if (!yymmdd || yymmdd.length !== 6) return "INVALID_DATE";
    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const year = (yy >= 70 ? "19" : "20") + yymmdd.substring(0, 2);
    const month = yymmdd.substring(2, 4);
    const day = yymmdd.substring(4, 6);
    return `${year}-${month}-${day}`;
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
