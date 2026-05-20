/**
 * Robust barcode parser for Medical Laboratory Inventory Management.
 * Handles GS1-compliant (Clinical Reagents) and Standard 1D barcodes.
 * 
 * @param {string} rawBarcode - The raw scanned barcode string.
 * @returns {Object} Structured data containing gtin, lot, expDate, etc.
 */
export const processAnyBarcode = (rawBarcode) => {
    if (!rawBarcode) return null;

    // Remove any surrounding whitespace or parentheses (sometimes added by keyboard emulators)
    const cleanBarcode = rawBarcode.trim();

    // GS1 Classification Logic:
    // Clinical reagents typically follow GS1-128 or DataMatrix standards.
    // Standard check: Starts with Application Identifier (01) for GTIN and has minimum expected length.
    if (cleanBarcode.startsWith("01") && cleanBarcode.length >= 18) {
        return parseGS1Barcode(cleanBarcode);
    }

    // Standard 1D Barcode Logic:
    // General consumables usually have simple EAN-13 or Code 128 without AIs.
    return {
        barcodeType: "STANDARD_1D",
        gtin: cleanBarcode,
        ref: "NEED_MANUAL_INPUT",
        lot: "NEED_MANUAL_INPUT",
        expDate: "NEED_MANUAL_INPUT",
        mfgDate: "NEED_MANUAL_INPUT",
        rawString: cleanBarcode
    };
};

/**
 * Parses GS1 barcodes using Application Identifiers (AIs).
 * Handles fixed and variable length fields with <GS> delimiter.
 */
const parseGS1Barcode = (raw) => {
    const result = {
        barcodeType: "GS1_COMPLIANT",
        gtin: "",
        ref: "",
        lot: "",
        expDate: "",
        mfgDate: "",
        rawString: raw
    };

    let i = 0;
    const GS = String.fromCharCode(29); // ASCII 29 Group Separator delimiter
    
    // Iteration safety limit to prevent infinite loops in case of malformed data
    let safetyCounter = 0;
    const maxAIs = 20; 

    while (i < raw.length && safetyCounter < maxAIs) {
        safetyCounter++;
        
        // Peek at possible Application Identifiers (AIs)
        const ai2 = raw.substring(i, i + 2);
        const ai3 = raw.substring(i, i + 3);

        // (01) GTIN: Global Trade Item Number - Fixed 14 digits
        if (ai2 === "01") {
            result.gtin = raw.substring(i + 2, i + 16);
            i += 16;
        } 
        // (11) MFG Date: Production Date - Fixed 6 digits (YYMMDD)
        else if (ai2 === "11") {
            result.mfgDate = formatGS1Date(raw.substring(i + 2, i + 8));
            i += 8;
        } 
        // (17) EXP Date: Expiry Date - Fixed 6 digits (YYMMDD)
        else if (ai2 === "17") {
            result.expDate = formatGS1Date(raw.substring(i + 2, i + 8));
            i += 8;
        } 
        // (10) Lot Number: Batch or Lot Number - Variable length (up to 20)
        else if (ai2 === "10") {
            const part = raw.substring(i + 2);
            const gsIndex = part.indexOf(GS);
            
            if (gsIndex !== -1) {
                // If <GS> found, take everything up to it (max 20)
                const lotValue = part.substring(0, gsIndex);
                result.lot = lotValue.substring(0, 20);
                i += 2 + gsIndex + 1; // Move past AI + value + GS
            } else {
                // No <GS>, take rest of string (max 20)
                result.lot = part.substring(0, 20);
                i = raw.length; // Consumed to the end
            }
        } 
        // (240) REF: Additional Product Identification - Variable length (up to 30)
        else if (ai3 === "240") {
            const part = raw.substring(i + 3);
            const gsIndex = part.indexOf(GS);
            
            if (gsIndex !== -1) {
                const refValue = part.substring(0, gsIndex);
                result.ref = refValue.substring(0, 30);
                i += 3 + gsIndex + 1;
            } else {
                result.ref = part.substring(0, 30);
                i = raw.length;
            }
        } 
        else {
            // Unknown AI encountered. To prevent infinite loops, 
            // we move forward and log the event if necessary.
            i++; 
        }
    }

    return result;
};

/**
 * Converts GS1 Date format (YYMMDD) to ISO format (YYYY-MM-DD).
 * @param {string} yymmdd 
 * @returns {string} YYYY-MM-DD
 */
const formatGS1Date = (yymmdd) => {
    if (!yymmdd || yymmdd.length !== 6) return "INVALID_DATE";
    
    const year = "20" + yymmdd.substring(0, 2);
    const month = yymmdd.substring(2, 4);
    const day = yymmdd.substring(4, 6);
    
    return `${year}-${month}-${day}`;
};
