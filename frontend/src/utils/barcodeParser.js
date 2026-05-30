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
        serial: "NEED_MANUAL_INPUT",
        origin: "NEED_MANUAL_INPUT",
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

    // B.2 Consume Best Before (15) - Always 6 digits (Fallback for EXP)
    const bestBeforeMatch = workingString.match(/15(\d{6})/);
    if (bestBeforeMatch) {
        if (result.expDate === "NEED_MANUAL_INPUT") {
            result.expDate = formatGS1Date(bestBeforeMatch[1]);
        }
        workingString = workingString.replace(bestBeforeMatch[0], ""); // Remove it
        foundGS1 = true;
    }

    // C. Consume MFG (11) - Always 6 digits
    const mfgMatch = workingString.match(/11(\d{6})/);
    if (mfgMatch) {
        result.mfgDate = formatGS1Date(mfgMatch[1]);
        workingString = workingString.replace(mfgMatch[0], ""); // Remove it
        foundGS1 = true;
    }

    // New: Consume Origin (422) - Always 3 digits
    const originMatch = workingString.match(/422(\d{3})/);
    if (originMatch) {
        result.origin = originMatch[1];
        workingString = workingString.replace(originMatch[0], "");
        foundGS1 = true;
    }

    // --- Variable Length Fields Handling ---
    // We use a non-greedy approach or split by GS if available
    const splitByGS = workingString.split(/\x1d/);
    
    const consumeVariable = (str) => {
        // AI (240) Material / Ref
        const rMatch = str.match(/240([a-zA-Z0-9/\-_.]+)/);
        if (rMatch) { result.ref = rMatch[1]; foundGS1 = true; return; }

        // AI (21) Serial
        const sMatch = str.match(/21([a-zA-Z0-9/\-_.]+)/);
        if (sMatch) { result.serial = sMatch[1]; foundGS1 = true; return; }

        // AI (10) Lot
        const lMatch = str.match(/10([a-zA-Z0-9/\-_.]+)/);
        if (lMatch) { result.lot = lMatch[1]; foundGS1 = true; return; }
    };

    if (splitByGS.length > 1) {
        splitByGS.forEach(part => consumeVariable(part));
    } else {
        // If no GS, we have to be careful. Let's try to match them individually 
        // by searching for the AI headers and taking content until the next known AI header or end.
        // For the specific case: 10, 21, 240
        const varFields = [
            { ai: '240', key: 'ref' },
            { ai: '21', key: 'serial' },
            { ai: '10', key: 'lot' }
        ];

        varFields.forEach(f => {
            const regex = new RegExp(`${f.ai}([a-zA-Z0-9/\\-_.]+)`);
            const match = workingString.match(regex);
            if (match) {
                // To avoid greedily consuming other AIs, we check if other AIs are inside the match
                let content = match[1];
                varFields.forEach(other => {
                    if (other.ai !== f.ai && content.includes(other.ai)) {
                        const parts = content.split(other.ai);
                        content = parts[0]; // Take only before the next AI
                    }
                });
                result[f.key] = content;
                workingString = workingString.replace(f.ai + content, "");
                foundGS1 = true;
            }
        });
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
