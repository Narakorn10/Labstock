// ==========================================
// ส่วนที่ 1: การตั้งค่า (Configuration)
// ==========================================
const MASTER_SHEET = 'MasterData'; 
const INV_SHEET = 'Inventory'; 
const LOG_SHEET = 'Logs';
const SETTING_SHEET = 'Settings';
const LINE_NOTIFY_TOKEN = ''; // ใส่ LINE Token ของคุณที่นี่

function doGet() {
  const template = HtmlService.createTemplateFromFile('index');
  
  // 🚀 [Performance Boost] ดึงข้อมูลเริ่มต้นจาก Server ทันที
  // วิธีนี้จะทำให้หน้าเว็บเปิดมาพร้อมข้อมูลเลย ไม่ต้องรอเรียก API อีกครั้งหลังโหลดเสร็จ
  try {
    template.initialData = {
      settings: getSettings(),
      dashboard: getDashboardData(),
      success: true
    };
  } catch (e) {
    template.initialData = { success: false, error: e.message };
  }

  return template.evaluate()
    .setTitle('Lab Smart System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getSheet(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    // 🛡️ [M2] Refactored: Robust Error Handling
    throw new Error(`ระบบขัดข้อง: ไม่พบแผ่นงานชื่อ "${sheetName}" กรุณา Setup DB ก่อนใช้งาน`);
  }
  return sheet;
}

function setupSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function createSheetWithHeaders(name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
      sheet.setFrozenRows(1); 
    }
  }

  createSheetWithHeaders(MASTER_SHEET, [
    'รหัสน้ำยา (Item ID)', 'รหัสสแกน (Barcode)', 'ชื่อน้ำยา', 
    'ประเภทน้ำยา', 'ประเภทงาน', 'ประเภทเครื่อง', 
    'หน่วย', 'จุดแจ้งเตือน(Min)', 'เป้าหมายหน้างานต่อสัปดาห์'
  ]);

  createSheetWithHeaders(INV_SHEET, [
    'รหัสน้ำยา (Item ID)', 'Lot No.', 'วันหมดอายุ (EXP)', 'ยอดคงเหลือใน Lot'
  ]);

  createSheetWithHeaders(LOG_SHEET, [
    'วันเวลา', 'รหัสน้ำยา (Item ID)', 'ชื่อน้ำยา', 
    'Lot No.', 'ทำรายการ', 'จำนวน', 'ผู้ทำรายการ'
  ]);

  createSheetWithHeaders(SETTING_SHEET, [
    'ประเภทน้ำยา', 'ประเภทงาน', 'ประเภทเครื่อง'
  ]);

  const settingSheet = ss.getSheetByName(SETTING_SHEET);
  if (settingSheet.getLastRow() === 1) {
    settingSheet.appendRow(['สารเคมีทั่วไป', 'เคมีคลินิก', 'เครื่อง Auto A']);
    settingSheet.appendRow(['สารละลาย', 'โลหิตวิทยา', 'เครื่อง Auto B']);
    settingSheet.appendRow(['สารชีวภาพ', 'ภูมิคุ้มกันวิทยา', 'Manual']);
    settingSheet.appendRow(['วัสดุสิ้นเปลือง', 'จุลชีววิทยา', 'อื่นๆ']);
  }

  return { success: true, message: 'สร้างแผ่นงานและหัวคอลัมน์สำเร็จเรียบร้อย!' };
}

// ==========================================
// ส่วนที่ 2: ดึงข้อมูล (Read)
// ==========================================

function getSettings() {
  try {
    const sheet = getSheet(SETTING_SHEET);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { reagentTypes: [], jobTypes: [], machineTypes: [] };
    
    const reagentTypes = []; const jobTypes = []; const machineTypes = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) reagentTypes.push(data[i][0].toString().trim());
      if (data[i][1]) jobTypes.push(data[i][1].toString().trim());    
      if (data[i][2]) machineTypes.push(data[i][2].toString().trim());
    }
    return { reagentTypes, jobTypes, machineTypes };
  } catch (error) {
    return { reagentTypes: [], jobTypes: [], machineTypes: [] };
  }
}

function getDashboardData() {
  try {
    const masterSheet = getSheet(MASTER_SHEET);
    const invSheet = getSheet(INV_SHEET);
    
    const masterData = masterSheet.getDataRange().getValues();
    if (masterData.length <= 1) return [];
    
    const invData = invSheet.getDataRange().getValues();
    const inventoryMap = {};
    
    for (let i = 1; i < invData.length; i++) {
      const itemId = invData[i][0].toString();
      const qty = parseInt(invData[i][3], 10) || 0;
      if (!inventoryMap[itemId]) inventoryMap[itemId] = { totalQty: 0, lots: [] };
      
      if (qty > 0) {
        inventoryMap[itemId].totalQty += qty;
        let expDateVal = invData[i][2];
        if (expDateVal instanceof Date) expDateVal = expDateVal.toISOString();
        inventoryMap[itemId].lots.push({
          rowIndex: i + 1,
          lotNo: invData[i][1],
          expDate: expDateVal,
          qty: qty
        });
      }
    }
    
    const items = [];
    for (let i = 1; i < masterData.length; i++) {
      const itemId = masterData[i][0].toString().trim();
      if (!itemId) continue; // ป้องกันแถวว่าง
      const invInfo = inventoryMap[itemId] || { totalQty: 0, lots: [] };
      items.push({
        itemId: itemId,
        qrCode: masterData[i][1],
        name: masterData[i][2],
        reagentType: masterData[i][3],
        jobType: masterData[i][4],
        machineType: masterData[i][5],
        unit: masterData[i][6],
        minThreshold: parseInt(masterData[i][7], 10) || 0,
        weeklyTarget: parseInt(masterData[i][8], 10) || 0,
        quantity: invInfo.totalQty,
        lots: invInfo.lots
      });
    }
    return items;
  } catch (error) {
    return [];
  }
}

function getReagentWithLots(scannedQr) {
  try {
    const masterSheet = getSheet(MASTER_SHEET);
    const invSheet = getSheet(INV_SHEET);
    
    const masterData = masterSheet.getDataRange().getValues();
    const searchKey = scannedQr.toString().trim().toLowerCase();
    if (!searchKey) return { success: false, message: 'กรุณากรอกคำค้นหา' };
    
    const searchTerms = searchKey.split(/\s+/).filter(t => t.length > 0);
    
    let exactMatchIdx = -1;
    let gs1MatchIdx = -1;
    let gs1MaxLen = -1;
    let partialMatchIdx = -1;

    for (let i = 1; i < masterData.length; i++) {
      const dbItemId = masterData[i][0].toString().trim().toLowerCase();
      if (!dbItemId) continue; // ป้องกันแถวว่าง
      const dbBarcode = masterData[i][1].toString().trim().toLowerCase();
      const dbName = masterData[i][2].toString().trim().toLowerCase();

      if (searchKey === dbBarcode || searchKey === dbItemId || searchKey === dbName) {
        exactMatchIdx = i; break; 
      }
      if (dbBarcode && searchKey.includes(dbBarcode)) {
        if (dbBarcode.length > gs1MaxLen) { gs1MaxLen = dbBarcode.length; gs1MatchIdx = i; }
      }
      if (partialMatchIdx === -1) {
          const textToSearch = `${dbItemId} ${dbBarcode} ${dbName}`;
          if (searchTerms.every(term => textToSearch.includes(term))) { partialMatchIdx = i; }
      }
    }

    let bestMatch = null;
    if (exactMatchIdx !== -1) bestMatch = exactMatchIdx;
    else if (gs1MatchIdx !== -1) bestMatch = gs1MatchIdx;
    else if (partialMatchIdx !== -1) bestMatch = partialMatchIdx;

    if (bestMatch === null) return { success: false, message: 'ไม่พบรายการสินค้านี้ในฐานข้อมูล' };
    
    const i = bestMatch;
    const item = { 
      itemId: masterData[i][0], qrCode: masterData[i][1], name: masterData[i][2], 
      reagentType: masterData[i][3], unit: masterData[i][6], 
      weeklyTarget: parseInt(masterData[i][8], 10) || 0
    };
    
    const lots = [];
    const invData = invSheet.getDataRange().getValues();
    for (let j = 1; j < invData.length; j++) {
      if (invData[j][0].toString() == item.itemId.toString() && parseInt(invData[j][3], 10) > 0) {
        let expDateVal = invData[j][2];
        if (expDateVal instanceof Date) expDateVal = expDateVal.toISOString();
        lots.push({ rowIndex: j + 1, lotNo: invData[j][1], expDate: expDateVal, qty: parseInt(invData[j][3], 10) });
      }
    }
    
    lots.sort((a, b) => new Date(a.expDate) - new Date(b.expDate));
    item.lots = lots;
    return { success: true, data: item };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function getLogs() {
  try {
    const sheet = getSheet(LOG_SHEET);
    const data = sheet.getDataRange().getValues();
    const logs = [];
    for (let i = data.length - 1; i >= 1 && logs.length <= 100; i--) {
      if (!data[i][0] || !data[i][1]) continue; // ป้องกันแถวว่าง
      let tsVal = data[i][0];
      if (tsVal instanceof Date) tsVal = tsVal.toISOString();
      logs.push({ timestamp: tsVal, itemId: data[i][1], name: data[i][2], lotNo: data[i][3], action: data[i][4], qty: parseInt(data[i][5], 10) || 0, user: data[i][6] });
    }
    return logs;
  } catch (error) {
    return [];
  }
}

function getAllLogsForExport() {
  try {
    const sheet = getSheet(LOG_SHEET);
    const data = sheet.getDataRange().getValues();
    return data.map(row => {
      if (row[0] instanceof Date) row[0] = row[0].toLocaleString('th-TH');
      return row;
    });
  } catch(error) {
    return [];
  }
}

function clearLogs() {
  try {
    const sheet = getSheet(LOG_SHEET);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
    return { success: true, message: 'ล้างประวัติการทำรายการเรียบร้อยแล้ว' };
  } catch(error) {
    return { success: false, message: error.message };
  }
}

// ==========================================
// ส่วนที่ 3: จัดการข้อมูล (Write)
// ==========================================

function addMasterItem(data) {
  try {
    const sheet = getSheet(MASTER_SHEET);
    const existing = sheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      if (existing[i][0].toString() === data.itemId.toString()) return { success: false, message: 'รหัสน้ำยา (Item ID) นี้ถูกใช้ไปแล้ว' };
    }
    sheet.appendRow([
      data.itemId, data.qrCode, data.name, data.reagentType, 
      data.jobType, data.machineType, data.unit, 
      parseInt(data.minThreshold, 10) || 0, parseInt(data.weeklyTarget, 10) || 0
    ]);
    return { success: true, message: 'บันทึกรายการหลักสำเร็จ' };
  } catch(error) {
    return { success: false, message: error.message };
  }
}

function updateMasterItem(data) {
  try {
    const sheet = getSheet(MASTER_SHEET);
    const existing = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < existing.length; i++) {
      if (existing[i][0].toString() === data.itemId.toString()) {
        rowIndex = i + 1; break;
      }
    }
    if (rowIndex === -1) return { success: false, message: 'ไม่พบรายการที่ต้องการแก้ไข' };
    
    sheet.getRange(rowIndex, 2, 1, 8).setValues([[
      data.qrCode, data.name, data.reagentType, data.jobType, data.machineType, data.unit, 
      parseInt(data.minThreshold, 10) || 0, parseInt(data.weeklyTarget, 10) || 0
    ]]);
    return { success: true, message: 'อัปเดตข้อมูลสำเร็จ' };
  } catch(error) {
    return { success: false, message: error.message };
  }
}

function receiveBatch(batchItems) {
  try {
    const invSheet = getSheet(INV_SHEET);
    const invData = invSheet.getDataRange().getValues(); 
    const masterData = getSheet(MASTER_SHEET).getDataRange().getValues();
    const itemNameMap = {};
    for(let i=1; i<masterData.length; i++) itemNameMap[masterData[i][0]] = masterData[i][2];

    batchItems.forEach(item => {
      let qty = parseInt(item.qty, 10);
      let found = false;
      for (let i = 1; i < invData.length; i++) {
        if (invData[i][0].toString() == item.itemId.toString() && invData[i][1].toString() == item.lotNo.toString()) {
          invData[i][3] = (parseInt(invData[i][3], 10) || 0) + qty;
          found = true; break;
        }
      }
      if (!found) {
        invData.push([item.itemId, item.lotNo, item.expDate, qty]);
      }
      logTransaction(item.itemId, itemNameMap[item.itemId] || 'Unknown', item.lotNo, 'รับเข้าสต๊อกหลัก', qty);
    });

    invSheet.getRange(1, 1, invData.length, 4).setValues(invData);
    return { success: true, message: `รับเข้าสำเร็จ ${batchItems.length} รายการ` };
  } catch(error) {
    return { success: false, message: error.message };
  }
}

// 🛡️ [L2] Refactored: แยกฟังก์ชันเช็คสต๊อกต่ำกว่าเกณฑ์ออกมา เพื่อให้โค้ดอ่านง่าย (Clean Code)
function processLowStockAlerts(batchItems, invData, masterInfoMap) {
  const checkedItems = new Set();
  batchItems.forEach(item => {
      if(checkedItems.has(item.itemId)) return;
      checkedItems.add(item.itemId);
      
      let totalLeft = 0;
      for(let i=1; i<invData.length; i++) {
        if(invData[i][0].toString() == item.itemId.toString()) {
          totalLeft += parseInt(invData[i][3], 10) || 0;
        }
      }

      const info = masterInfoMap[item.itemId];
      if (info && totalLeft <= info.minAlert) {
        sendLineNotify(`⚠️ น้ำยาใกล้หมด!\nรหัส: ${item.itemId}\nชื่อ: ${info.name}\nคงเหลือ: ${totalLeft} ${info.unit}`);
      }
  });
}

function dispenseBatch(batchItems) {
  try {
    const invSheet = getSheet(INV_SHEET);
    const invData = invSheet.getDataRange().getValues();
    const masterData = getSheet(MASTER_SHEET).getDataRange().getValues();
    
    const masterInfoMap = {};
    for(let i=1; i<masterData.length; i++) {
        masterInfoMap[masterData[i][0]] = { name: masterData[i][2], unit: masterData[i][6], minAlert: parseInt(masterData[i][7], 10) || 0 };
    }
    
    batchItems.forEach(item => {
      const arrayIdx = item.rowIndex - 1;
      let currentQty = parseInt(invData[arrayIdx][3], 10) || 0;
      let qty = parseInt(item.qty, 10);
      if (currentQty >= qty) {
        invData[arrayIdx][3] = currentQty - qty;
        logTransaction(item.itemId, masterInfoMap[item.itemId].name, item.lotNo, 'เบิกไปหน้างาน', qty);
      }
    });

    invSheet.getRange(1, 1, invData.length, 4).setValues(invData);
    
    // เรียกใช้ฟังก์ชันย่อยสำหรับการแจ้งเตือน
    processLowStockAlerts(batchItems, invData, masterInfoMap);
    
    return { success: true, message: `เบิกจ่ายสำเร็จ` };
  } catch(error) {
    return { success: false, message: error.message };
  }
}

function logTransaction(itemId, name, lotNo, action, qty, user = 'เจ้าหน้าที่') {
  try {
    const sheet = getSheet(LOG_SHEET);
    sheet.appendRow([new Date(), itemId, name, lotNo, action, qty, user]);
  } catch (error) {
    console.error("Log failed:", error);
  }
}

function sendLineNotify(message) {
  if (!LINE_NOTIFY_TOKEN) return;
  const options = { method: 'post', payload: { message: message }, headers: { Authorization: 'Bearer ' + LINE_NOTIFY_TOKEN } };
  try { UrlFetchApp.fetch('https://notify-api.line.me/api/notify', options); } catch (e) {}
}

/**
 * 🚀 [Vercel Support] รับการเรียกจากภายนอก (CORS-friendly)
 */
function doPost(e) {
  let result;
  try {
    const postData = JSON.parse(e.postData.contents);
    const method = postData.method;
    const args = postData.args || [];
    
    switch(method) {
      case 'getSettings': result = getSettings(); break;
      case 'getDashboardData': result = getDashboardData(); break;
      case 'getReagentWithLots': result = getReagentWithLots(args[0]); break;
      case 'getLogs': result = getLogs(); break;
      case 'getAllLogsForExport': result = getAllLogsForExport(); break;
      case 'clearLogs': result = clearLogs(); break;
      case 'setupSystem': result = setupSystem(); break;
      case 'addMasterItem': result = addMasterItem(args[0]); break;
      case 'updateMasterItem': result = updateMasterItem(args[0]); break;
      case 'receiveBatch': result = receiveBatch(args[0]); break;
      case 'dispenseBatch': result = dispenseBatch(args[0]); break;
      default: throw new Error(`ไม่พบ Method: ${method}`);
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}