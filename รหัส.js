// ==========================================
// ส่วนที่ 1: การตั้งค่า (Configuration)
// ==========================================
const MASTER_SHEET = 'MasterData'; 
const INV_SHEET = 'Inventory'; 
const LOG_SHEET = 'Logs';
const SETTING_SHEET = 'Settings';
const USER_SHEET = 'Users';

// 🛡️ [C1] Security Fix: ดึง Token จาก Script Properties แทนการ Hardcode ในไฟล์
function getLineToken() {
  return PropertiesService.getScriptProperties().getProperty('LINE_TOKEN') || '';
}

// 🛡️ Security Utilities
function hashPassword(password) {
  const digest = Uint8Array.from(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password));
  return digest.map(byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
}

function generateToken() {
  return Utilities.getUuid();
}

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

/**
 * 🛠️ Helper: แปลงข้อมูลจาก Sheet เป็น Array ของ Object ตามหัวคอลัมน์
 */
function getSheetDataAsObjects(sheetName) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const headers = data[0].map(h => h.toString().trim());
  return data.slice(1).map((row, index) => {
    const obj = { _rowIndex: index + 2 }; // เก็บ Row Index จริงไว้เผื่อใช้
    headers.forEach((header, i) => {
      let val = row[i];
      if (val instanceof Date) val = val.toISOString();
      obj[header] = (val === null || val === undefined) ? "" : val.toString().trim();
    });
    return obj;
  });
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
    return sheet;
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

  const userSheet = createSheetWithHeaders(USER_SHEET, [
    'Username', 'PasswordHash', 'Role', 'Token', 'TokenExpiry', 'Name'
  ]);

  // Create Default Admin if no users exist
  if (userSheet.getLastRow() === 1) {
    const defaultAdmin = ['admin', hashPassword('admin1234'), 'Admin', '', '', 'System Administrator'];
    userSheet.appendRow(defaultAdmin);
  }

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
// ส่วนที่ 1.5: ระบบความปลอดภัย (Authentication)
// ==========================================

function login(username, password) {
  try {
    const data = getSheetDataAsObjects(USER_SHEET);
    const user = data.find(u => u.Username === username);
    
    if (!user || user.PasswordHash !== hashPassword(password)) {
      return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }
    
    const token = generateToken();
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24); // Token valid for 24 hours
    
    const sheet = getSheet(USER_SHEET);
    sheet.getRange(user._rowIndex, 4, 1, 2).setValues([[token, expiry.toISOString()]]);
    
    return { 
      success: true, 
      token: token, 
      user: { username: user.Username, name: user.Name, role: user.Role } 
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function logout(token) {
  try {
    if (!token) return { success: true };
    const sheet = getSheet(USER_SHEET);
    const data = getSheetDataAsObjects(USER_SHEET);
    const user = data.find(u => u.Token === token);
    if (user) {
      sheet.getRange(user._rowIndex, 4, 1, 1).setValue('');
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function validateSession(token) {
  try {
    if (!token) return { success: false };
    const data = getSheetDataAsObjects(USER_SHEET);
    const user = data.find(u => u.Token === token);
    
    if (!user) return { success: false };
    
    const expiry = new Date(user.TokenExpiry);
    if (expiry < new Date()) {
      logout(token);
      return { success: false, message: 'Session หมดอายุ' };
    }
    
    return { 
      success: true, 
      user: { username: user.Username, name: user.Name, role: user.Role } 
    };
  } catch (error) {
    return { success: false };
  }
}

function checkAccess(token, requiredRoles) {
  const session = validateSession(token);
  if (!session.success) return { success: false, message: 'กรุณาเข้าสู่ระบบ' };
  if (!requiredRoles.includes(session.user.role)) return { success: false, message: 'คุณไม่มีสิทธิ์ทำรายการนี้' };
  return { success: true, user: session.user };
}

// ==========================================
// ส่วนที่ 2: ดึงข้อมูล (Read)
// ==========================================

function getSettings() {
  try {
    const data = getSheetDataAsObjects(SETTING_SHEET);
    return {
      reagentTypes: data.map(d => d['ประเภทน้ำยา']).filter(v => v !== ""),
      jobTypes: data.map(d => d['ประเภทงาน']).filter(v => v !== ""),
      machineTypes: data.map(d => d['ประเภทเครื่อง']).filter(v => v !== "")
    };
  } catch (error) {
    return { reagentTypes: [], jobTypes: [], machineTypes: [] };
  }
}

function getDashboardData() {
  try {
    const masterData = getSheetDataAsObjects(MASTER_SHEET);
    const invData = getSheetDataAsObjects(INV_SHEET);
    
    // สร้าง Map ของ Inventory เพื่อให้ค้นหาได้เร็ว (Group by Item ID)
    const inventoryMap = invData.reduce((map, item) => {
      const id = item['รหัสน้ำยา (Item ID)'];
      const qty = parseInt(item['ยอดคงเหลือใน Lot'], 10) || 0;
      if (qty > 0) {
        if (!map[id]) map[id] = { totalQty: 0, lots: [] };
        map[id].totalQty += qty;
        map[id].lots.push({ 
          rowIndex: item._rowIndex, 
          lotNo: item['Lot No.'], 
          expDate: item['วันหมดอายุ (EXP)'], 
          qty: qty 
        });
      }
      return map;
    }, {});
    
    return masterData.map(m => {
      const invInfo = inventoryMap[m['รหัสน้ำยา (Item ID)']] || { totalQty: 0, lots: [] };
      return {
        itemId: m['รหัสน้ำยา (Item ID)'],
        qrCode: m['รหัสสแกน (Barcode)'],
        name: m['ชื่อน้ำยา'],
        reagentType: m['ประเภทน้ำยา'],
        jobType: m['ประเภทงาน'],
        machineType: m['ประเภทเครื่อง'],
        unit: m['หน่วย'],
        minThreshold: parseInt(m['จุดแจ้งเตือน(Min)'], 10) || 0,
        weeklyTarget: parseInt(m['เป้าหมายหน้างานต่อสัปดาห์'], 10) || 0,
        quantity: invInfo.totalQty,
        lots: invInfo.lots
      };
    }).filter(item => item.itemId !== ""); // กรองแถวว่าง
  } catch (error) {
    console.error("getDashboardData Error:", error);
    return [];
  }
}

function getReagentWithLots(scannedQr) {
  try {
    const data = getDashboardData();
    const searchKey = scannedQr.toString().trim().toLowerCase();
    if (!searchKey) return { success: false, message: 'กรุณากรอกคำค้นหา' };

    let bestMatch = null;
    let priority = -1;

    for (let item of data) {
      const id = (item.itemId || '').toLowerCase();
      const qr = (item.qrCode || '').toLowerCase();
      const name = (item.name || '').toLowerCase();

      if (id === searchKey || qr === searchKey) { bestMatch = item; priority = 3; break; }
      if (qr && qr.length > 4 && searchKey.includes(qr) && priority < 3) { bestMatch = item; priority = 3; }
      if (name.startsWith(searchKey) && priority < 2) { bestMatch = item; priority = 2; }
      if (name.includes(searchKey) && priority < 1) { bestMatch = item; priority = 1; }
    }

    if (!bestMatch) return { success: false, message: 'ไม่พบรายการนี้ในระบบ' };
    return { success: true, data: bestMatch };
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
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
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
  } finally {
    lock.releaseLock();
  }
}

function updateMasterItem(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
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
  } finally {
    lock.releaseLock();
  }
}

function receiveBatch(batchItems, userName = 'เจ้าหน้าที่') {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const invSheet = getSheet(INV_SHEET);
    const invData = invSheet.getDataRange().getValues(); 
    const masterData = getDashboardData(); // ใช้ฟังก์ชันเดิมที่ refactor แล้วเพื่อเอาชื่อน้ำยาได้ง่ายๆ
    const nameMap = masterData.reduce((map, item) => ({...map, [item.itemId]: item.name}), {});

    batchItems.forEach(item => {
      let qty = parseInt(item.qty, 10);
      let foundRow = -1;
      
      // ค้นหาแถวที่มี Item ID และ Lot ตรงกัน
      for (let i = 1; i < invData.length; i++) {
        if (invData[i][0].toString() === item.itemId.toString() && invData[i][1].toString() === item.lotNo.toString()) {
          foundRow = i; break;
        }
      }

      if (foundRow >= 0) {
        invData[foundRow][3] = (parseInt(invData[foundRow][3], 10) || 0) + qty;
      } else {
        invData.push([item.itemId, item.lotNo, item.expDate, qty]);
      }
      logTransaction(item.itemId, nameMap[item.itemId] || 'Unknown', item.lotNo, 'รับเข้าสต๊อกหลัก', qty, userName);
    });

    invSheet.getRange(1, 1, invData.length, 4).setValues(invData);
    return { success: true, message: `รับเข้าสำเร็จ ${batchItems.length} รายการ` };
  } catch(error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

function dispenseBatch(batchItems, userName = 'เจ้าหน้าที่') {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const invSheet = getSheet(INV_SHEET);
    const invData = invSheet.getDataRange().getValues();
    const masterData = getDashboardData();
    const masterInfoMap = masterData.reduce((map, item) => ({...map, [item.itemId]: item}), {});
    
    let failedItems = [];

    batchItems.forEach(item => {
      let arrayIdx = item.rowIndex - 1;
      
      // 🛡️ Safety check: ตรวจสอบว่าแถวยังตรงกับรหัสและ Lot อยู่หรือไม่
      const rowValid = invData[arrayIdx] && 
                       invData[arrayIdx][0].toString() === item.itemId.toString() && 
                       invData[arrayIdx][1].toString() === item.lotNo.toString();

      if (!rowValid) {
        arrayIdx = -1;
        for(let i = 1; i < invData.length; i++) {
          if (invData[i][0].toString() === item.itemId.toString() && invData[i][1].toString() === item.lotNo.toString()) {
            arrayIdx = i; break;
          }
        }
      }

      if (arrayIdx >= 0) {
        let currentQty = parseInt(invData[arrayIdx][3], 10) || 0;
        let qty = parseInt(item.qty, 10);
        if (currentQty >= qty) {
          invData[arrayIdx][3] = currentQty - qty;
          logTransaction(item.itemId, masterInfoMap[item.itemId]?.name || 'Unknown', item.lotNo, 'เบิกไปหน้างาน', qty, userName);
        } else {
          failedItems.push(`${masterInfoMap[item.itemId]?.name} (Lot: ${item.lotNo})`);
        }
      } else {
        failedItems.push(`${masterInfoMap[item.itemId]?.name} (Lot: ${item.lotNo}) - ไม่พบข้อมูล`);
      }
    });

    invSheet.getRange(1, 1, invData.length, 4).setValues(invData);
    
    // เรียกใช้ฟังก์ชันย่อยสำหรับการแจ้งเตือน
    processLowStockAlerts(batchItems, invData, masterInfoMap);
    
    if (failedItems.length > 0) {
      return { success: false, message: `สต๊อกไม่พอเบิกสำหรับ:\n${failedItems.join('\n')}` };
    }
    
    return { success: true, message: `เบิกจ่ายสำเร็จ` };
  } catch(error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

// 🛡️ [L2] Refactored: แยกฟังก์ชันเช็คสต๊อกต่ำกว่าเกณฑ์ออกมา เพื่อให้โค้ดอ่านง่าย (Clean Code)
function processLowStockAlerts(batchItems, invData, masterInfoMap) {
  const checkedItems = new Set();
  batchItems.forEach(item => {
      const itemId = item.itemId.toString();
      if(checkedItems.has(itemId)) return;
      checkedItems.add(itemId);
      
      let totalLeft = 0;
      for(let i=1; i<invData.length; i++) {
        if(invData[i][0].toString() === itemId) {
          totalLeft += parseInt(invData[i][3], 10) || 0;
        }
      }

      const info = masterInfoMap[itemId];
      if (info && totalLeft <= info.minThreshold) { 
        sendLineNotify(`⚠️ น้ำยาใกล้หมด!\nรหัส: ${itemId}\nชื่อ: ${info.name}\nคงเหลือ: ${totalLeft} ${info.unit}`);
      }
  });
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
  const token = getLineToken();
  if (!token) return;
  const options = { method: 'post', payload: { message: message }, headers: { Authorization: 'Bearer ' + token } };
  try { UrlFetchApp.fetch('https://notify-api.line.me/api/notify', options); } catch (e) {}
}

function adjustLotQuantity(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const invSheet = getSheet(INV_SHEET);
    const rowIndex = parseInt(data.rowIndex, 10);
    const newQty = parseInt(data.newQty, 10);
    
    // ดึงข้อมูลแถวปัจจุบันมาเช็คความถูกต้อง
    const currentRow = invSheet.getRange(rowIndex, 1, 1, 4).getValues()[0];
    if (currentRow[0].toString() !== data.itemId.toString() || currentRow[1].toString() !== data.lotNo.toString()) {
      return { success: false, message: 'ข้อมูลแถวไม่ตรงกัน กรุณารีเฟรชหน้าจอแล้วลองใหม่' };
    }

    const oldQty = parseInt(currentRow[3], 10) || 0;
    const diff = newQty - oldQty;
    
    if (diff === 0) return { success: true, message: 'ไม่มีการเปลี่ยนแปลงจำนวน' };

    // อัปเดตยอดใหม่
    invSheet.getRange(rowIndex, 4).setValue(newQty);
    
    // บันทึก Log ส่วนต่าง
    const masterData = getDashboardData();
    const info = masterData.find(i => i.itemId === data.itemId);
    logTransaction(data.itemId, info ? info.name : 'Unknown', data.lotNo, 'ปรับปรุงยอด (Adjustment)', Math.abs(diff), `ปรับปรุง (${diff > 0 ? '+' : ''}${diff})`);

    return { success: true, message: 'ปรับปรุงยอดสำเร็จ' };
  } catch(error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

function getUsageReport(startDate, endDate) {
  try {
    const logs = getSheetDataAsObjects(LOG_SHEET);
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // ให้ครอบคลุมทั้งวันสิ้นสุด

    const summary = {};

    logs.forEach(log => {
      const ts = new Date(log['วันเวลา']);
      if (ts >= start && ts <= end) {
        const action = log['ทำรายการ'];
        const itemId = log['รหัสน้ำยา (Item ID)'];
        const name = log['ชื่อน้ำยา'];
        const qty = parseInt(log['จำนวน'], 10) || 0;

        if (!summary[itemId]) {
          summary[itemId] = { itemId, name, dispensed: 0, adjusted: 0, received: 0 };
        }

        if (action === 'เบิกไปหน้างาน') {
          summary[itemId].dispensed += qty;
        } else if (action === 'รับเข้าสต๊อกหลัก') {
          summary[itemId].received += qty;
        } else if (action.includes('ปรับปรุงยอด')) {
          summary[itemId].adjusted += qty; 
        }
      }
    });

    return Object.values(summary);
  } catch (error) {
    console.error("getUsageReport Error:", error);
    return [];
  }
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
    const token = postData.token; // รับ Token จาก Frontend
    
    // 🛡️ Helper สำหรับเช็คสิทธิ์ใน doPost
    const verify = (roles) => {
      const access = checkAccess(token, roles);
      if (!access.success) throw new Error(access.message);
      return access.user;
    };

    switch(method) {
      case 'login': result = login(args[0], args[1]); break;
      case 'logout': result = logout(token); break;
      case 'validateSession': result = validateSession(token); break;
      
      case 'getSettings': result = getSettings(); break;
      case 'getDashboardData': result = getDashboardData(); break;
      case 'getReagentWithLots': result = getReagentWithLots(args[0]); break;
      case 'getLogs': result = getLogs(); break;
      case 'getAllLogsForExport': result = getAllLogsForExport(); break;
      case 'getUsageReport': result = getUsageReport(args[0], args[1]); break;

      // 🔐 Protected Operations
      case 'setupSystem': 
        verify(['Admin']);
        result = setupSystem(); 
        break;
      case 'addMasterItem': 
        verify(['Admin', 'Manager']);
        result = addMasterItem(args[0]); 
        break;
      case 'updateMasterItem': 
        verify(['Admin', 'Manager']);
        result = updateMasterItem(args[0]); 
        break;
      case 'receiveBatch': 
        const userRec = verify(['Admin', 'Manager', 'User']);
        result = receiveBatch(args[0], userRec.name); 
        break;
      case 'dispenseBatch': 
        const userDisp = verify(['Admin', 'Manager', 'User']);
        result = dispenseBatch(args[0], userDisp.name); 
        break;
      case 'adjustLotQuantity': 
        const userAdj = verify(['Admin', 'Manager']);
        result = adjustLotQuantity(args[0], userAdj.name); 
        break;
      case 'clearLogs': 
        verify(['Admin']);
        result = clearLogs(); 
        break;
        
      default: throw new Error(`ไม่พบ Method: ${method}`);
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}