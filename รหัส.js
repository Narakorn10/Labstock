// ==========================================
// ส่วนที่ 1: การตั้งค่า (Configuration)
// ==========================================
const MASTER_SHEET = 'MasterData'; 
const INV_SHEET = 'Inventory'; 
const LOG_SHEET = 'Logs';
const SETTING_SHEET = 'Settings';
const USER_SHEET = 'Users';

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
    const obj = { _rowIndex: index + 2 }; 
    headers.forEach((header, i) => {
      let val = row[i];
      if (val instanceof Date) val = val.toISOString();
      obj[header] = (val === null || val === undefined) ? "" : val.toString().trim();
    });
    return obj;
  });
}

function setupSystem(token) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // ตรวจสอบสิทธิ์ (ถ้ามี User Sheet แล้วต้องเป็น Admin เท่านั้น)
  if (ss.getSheetByName(USER_SHEET)) {
    checkAccess(token, ['Admin']);
  }

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
    expiry.setHours(expiry.getHours() + 24); 
    
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
  if (!session.success) throw new Error(session.message || 'กรุณาเข้าสู่ระบบ');
  if (!requiredRoles.includes(session.user.role)) throw new Error('คุณไม่มีสิทธิ์ทำรายการนี้');
  return session.user;
}

// 👤 User Management (Admin Only)
function getUsers() {
  try {
    const data = getSheetDataAsObjects(USER_SHEET);
    return data.map(u => ({
      username: u.Username,
      name: u.Name,
      role: u.Role
    }));
  } catch (error) {
    return [];
  }
}

function addUser(userData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(USER_SHEET);
    const existing = getSheetDataAsObjects(USER_SHEET);
    if (existing.find(u => u.Username === userData.username)) {
      return { success: false, message: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' };
    }
    
    sheet.appendRow([
      userData.username,
      hashPassword(userData.password),
      userData.role,
      '', '', // Token, Expiry
      userData.name
    ]);
    return { success: true, message: 'เพิ่มผู้ใช้สำเร็จ' };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

function deleteUser(targetUsername) {
  if (targetUsername === 'admin') return { success: false, message: 'ไม่สามารถลบผู้ดูแลระบบหลักได้' };
  
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(USER_SHEET);
    const data = getSheetDataAsObjects(USER_SHEET);
    const user = data.find(u => u.Username === targetUsername);
    if (user) {
      sheet.deleteRow(user._rowIndex);
      return { success: true, message: 'ลบผู้ใช้เรียบร้อยแล้ว' };
    }
    return { success: false, message: 'ไม่พบผู้ใช้ที่ต้องการลบ' };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
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
    }).filter(item => item.itemId !== ""); 
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
      if (!data[i][0] || !data[i][1]) continue; 
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

function clearLogs(token) {
  try {
    checkAccess(token, ['Admin']);
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

function addMasterItem(data, token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    checkAccess(token, ['Admin', 'Manager']);
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

function updateMasterItem(data, token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    checkAccess(token, ['Admin', 'Manager']);
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

function receiveBatch(batchItems, token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const user = checkAccess(token, ['Admin', 'Manager', 'User']);
    const userName = user.name;
    const invSheet = getSheet(INV_SHEET);
    const invData = invSheet.getDataRange().getValues(); 
    const masterData = getDashboardData(); 
    const nameMap = masterData.reduce((map, item) => ({...map, [item.itemId]: item.name}), {});

    batchItems.forEach(item => {
      let qty = parseInt(item.qty, 10);
      let foundRow = -1;
      
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

function dispenseBatch(batchItems, token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const user = checkAccess(token, ['Admin', 'Manager', 'User']);
    const userName = user.name;
    const invSheet = getSheet(INV_SHEET);
    const invData = invSheet.getDataRange().getValues();
    const masterData = getDashboardData();
    const masterInfoMap = masterData.reduce((map, item) => ({...map, [item.itemId]: item}), {});
    
    let failedItems = [];

    batchItems.forEach(item => {
      let arrayIdx = item.rowIndex - 1;
      
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

    const finalInvData = invData.filter((row, idx) => idx === 0 || (parseInt(row[3], 10) || 0) > 0);
    invSheet.clearContents();
    invSheet.getRange(1, 1, finalInvData.length, 4).setValues(finalInvData);

    processLowStockAlerts(batchItems, finalInvData, masterInfoMap);
    
    if (failedItems.length > 0) {
      return { success: false, message: `สต๊อกไม่พอเบิกสำหรับ:\n${failedItems.join('\n')}` };
    }
    
    return { success: true, message: `เบิกจ่ายสำเร็จ (ทำความสะอาด Ghost data แล้ว)` };
  } catch(error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

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

function adjustLotQuantity(data, token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const user = checkAccess(token, ['Admin', 'Manager']);
    const invSheet = getSheet(INV_SHEET);
    const rowIndex = parseInt(data.rowIndex, 10);
    const newQty = parseInt(data.newQty, 10);
    
    const currentRow = invSheet.getRange(rowIndex, 1, 1, 4).getValues()[0];
    if (currentRow[0].toString() !== data.itemId.toString() || currentRow[1].toString() !== data.lotNo.toString()) {
      return { success: false, message: 'ข้อมูลแถวไม่ตรงกัน กรุณารีเฟรชหน้าจอแล้วลองใหม่' };
    }

    const oldQty = parseInt(currentRow[3], 10) || 0;
    const diff = newQty - oldQty;
    
    if (diff === 0) return { success: true, message: 'ไม่มีการเปลี่ยนแปลงจำนวน' };

    if (newQty === 0) {
      invSheet.deleteRow(rowIndex);
    } else {
      invSheet.getRange(rowIndex, 4).setValue(newQty);
    }
    
    const masterData = getDashboardData();
    const info = masterData.find(i => i.itemId === data.itemId);
    logTransaction(data.itemId, info ? info.name : 'Unknown', data.lotNo, 'ปรับปรุงยอด (Adjustment)', Math.abs(diff), `ปรับปรุง (${diff > 0 ? '+' : ''}${diff}) [โดย ${user.name}]`);

    return { success: true, message: 'ปรับปรุงยอดสำเร็จ' };
  } catch(error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

function getUsageReport(startDate, endDate, token) {
  try {
    checkAccess(token, ['Admin', 'Manager', 'User']);
    const logs = getSheetDataAsObjects(LOG_SHEET);
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); 

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
 * 🚀 [Universal Entry Point] Handles Vercel Web App (JSON) and Telegram Webhook
 */
function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    

    // B. Web App API Call
    const method = postData.method;
    const args = postData.args || [];
    const token = postData.token; 

    let result;
    switch(method) {
      case 'login': result = login(args[0], args[1]); break;
      case 'logout': result = logout(token); break;
      case 'validateSession': result = validateSession(token); break;
      
      case 'getSettings': result = getSettings(); break;
      case 'getDashboardData': result = getDashboardData(); break;
      case 'getReagentWithLots': result = getReagentWithLots(args[0]); break;
      case 'getLogs': result = getLogs(); break;
      case 'getAllLogsForExport': result = getAllLogsForExport(); break;
      case 'getUsageReport': result = getUsageReport(args[0], args[1], token); break;

      case 'setupSystem': result = setupSystem(token); break;
      case 'addMasterItem': result = addMasterItem(args[0], token); break;
      case 'updateMasterItem': result = updateMasterItem(args[0], token); break;
      case 'receiveBatch': result = receiveBatch(args[0], token); break;
      case 'dispenseBatch': result = dispenseBatch(args[0], token); break;
      case 'adjustLotQuantity': result = adjustLotQuantity(args[0], token); break;
      case 'clearLogs': result = clearLogs(token); break;

      // 👤 User Management (Admin Only)
      case 'getUsers': 
        checkAccess(token, ['Admin']);
        result = getUsers(); 
        break;
      case 'addUser': 
        checkAccess(token, ['Admin']);
        result = addUser(args[0]); 
        break;
      case 'deleteUser': 
        checkAccess(token, ['Admin']);
        result = deleteUser(args[0]); 
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

// ==========================================
// ส่วนที่ 4: ระบบ Telegram Bot & Gemini OCR
// ==========================================

function handleTelegramUpdate(update) {
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;

    if (msg.photo) {
      processTelegramImage(msg.photo, chatId);
    } else if (msg.text) {
      const text = msg.text.trim();
      if (text === '/start') {
        sendTelegramMessage(chatId, "ยินดีต้อนรับสู่ระบบ Lab Smart System! 🧪\n\nกรุณาส่งรูปภาพใบ Invoice น้ำยา เพื่อให้ Gemini AI ช่วยประมวลผลรับเข้าสต๊อกครับ");
      } else {
        // 💬 ฟีเจอร์ใหม่: พิมพ์เพื่อแก้ไขข้อมูลที่ AI อ่านผิด
        handleTelegramTextFeedback(chatId, text);
      }
    }
  } else if (update.callback_query) {
    handleTelegramCallback(update.callback_query);
  }
}

function processTelegramImage(photoArray, chatId) {
  try {
    sendTelegramMessage(chatId, "⏳ กำลังประมวลผลรูปภาพด้วย Gemini AI... กรุณารอสักครู่");
    
    // 1. Get high-res photo file info
    const fileId = photoArray[photoArray.length - 1].file_id;
    const fileUrl = getTelegramFileUrl(fileId);
    
    // 2. Download and convert to Base64
    const response = UrlFetchApp.fetch(fileUrl);
    const base64Image = Utilities.base64Encode(response.getBlob().getBytes());

    // 3. Call Gemini API
    const extractedData = callGeminiOCR(base64Image);
    
    if (!extractedData || extractedData.length === 0) {
      sendTelegramMessage(chatId, "❌ ไม่พบข้อมูลน้ำยาในรูปภาพนี้ หรือรูปภาพไม่ชัดเจน กรุณาลองใหม่อีกครั้ง");
      return;
    }

    // 4. Match with MasterData
    const masterData = getDashboardData();
    const processedItems = extractedData.map(item => {
      const match = matchReagentName(item.name, masterData);
      return {
        ...item,
        itemId: match ? match.itemId : 'NEW_ITEM',
        masterName: match ? match.name : item.name,
        isNew: !match
      };
    });

    // 💾 เก็บข้อมูลไว้ใน Cache เพื่อรอการแก้ไขหรือยืนยัน
    savePendingInvoice(chatId, processedItems);

    // 5. Send Summary and Confirmation Buttons
    sendTelegramInvoiceSummary(chatId, processedItems);

  } catch (e) {
    sendTelegramMessage(chatId, "❌ เกิดข้อผิดพลาด: " + e.message);
  }
}

/**
 * 💬 จัดการการพิมพ์ข้อความเพื่อแก้ไขข้อมูล (Chat-to-Fix)
 */
function handleTelegramTextFeedback(chatId, userText) {
  const pendingData = getPendingInvoice(chatId);
  if (!pendingData) {
    sendTelegramMessage(chatId, "💡 คุณสามารถส่งรูปภาพใบ Invoice เพื่อเริ่มการประมวลผลได้ครับ");
    return;
  }

  try {
    sendTelegramMessage(chatId, "⏳ กำลังปรับปรุงข้อมูลตามที่คุณบอก...");
    
    const correctedData = callGeminiCorrection(pendingData, userText);
    
    if (correctedData) {
      const masterData = getDashboardData();
      const processedItems = correctedData.map(item => {
        const match = matchReagentName(item.name, masterData);
        return {
          ...item,
          itemId: match ? match.itemId : 'NEW_ITEM',
          masterName: match ? match.name : item.name,
          isNew: !match
        };
      });

      savePendingInvoice(chatId, processedItems);
      sendTelegramInvoiceSummary(chatId, processedItems, true);
    }
  } catch (e) {
    sendTelegramMessage(chatId, "❌ ไม่สามารถแก้ไขข้อมูลได้: " + e.message);
  }
}

function callGeminiCorrection(oldJson, correctionText) {
  const apiKey = getGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{
      parts: [{
        text: "You are a medical inventory assistant. I will provide a JSON array of items and a user's correction instruction in Thai. " +
              "Apply the correction to the JSON data and return the UPDATED JSON array ONLY. " +
              "\n\nJSON: " + JSON.stringify(oldJson) + 
              "\n\nInstruction: " + correctionText
      }]
    }],
    generationConfig: { response_mime_type: "application/json" }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(res.getContentText());
  
  try {
    const text = json.candidates[0].content.parts[0].text;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function savePendingInvoice(chatId, items) {
  const cache = PropertiesService.getUserProperties();
  cache.setProperty('PENDING_INV_' + chatId, JSON.stringify(items));
}

function getPendingInvoice(chatId) {
  const cache = PropertiesService.getUserProperties();
  const data = cache.getProperty('PENDING_INV_' + chatId);
  return data ? JSON.parse(data) : null;
}

function clearPendingInvoice(chatId) {
  const cache = PropertiesService.getUserProperties();
  cache.deleteProperty('PENDING_INV_' + chatId);
}

function callGeminiOCR(base64Image) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{
      parts: [
        { text: "This is an invoice for medical reagents. Extract all items into a JSON array. For each item, identify: 'name' (product name), 'lotNo' (batch/lot number), 'expDate' (format YYYY-MM-DD), and 'qty' (quantity as number). Return ONLY a raw JSON array. No markdown code blocks." },
        { inline_data: { mime_type: "image/jpeg", data: base64Image } }
      ]
    }],
    generationConfig: {
      response_mime_type: "application/json"
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(res.getContentText());
  
  try {
    if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) {
      const text = json.candidates[0].content.parts[0].text;
      return JSON.parse(text);
    }
  } catch (e) {
    console.error("Gemini Parse Error:", e);
  }
  return null;
}

function matchReagentName(extractedName, masterData) {
  const cleanName = extractedName.toLowerCase().trim();
  let match = masterData.find(m => m.name.toLowerCase().trim() === cleanName || (m.qrCode && m.qrCode.toLowerCase() === cleanName));
  if (match) return match;
  match = masterData.find(m => cleanName.includes(m.name.toLowerCase().trim()) || m.name.toLowerCase().trim().includes(cleanName));
  return match || null;
}

function getTelegramFileUrl(fileId) {
  const token = getTelegramBotToken();
  const url = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
  const res = UrlFetchApp.fetch(url);
  const fileData = JSON.parse(res.getContentText());
  if (fileData.ok) {
    return `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
  }
  throw new Error("Failed to get file path from Telegram");
}

function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const token = getTelegramBotToken();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML"
  };
  if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };
  UrlFetchApp.fetch(url, options);
}

function sendTelegramInvoiceSummary(chatId, items, isUpdate = false) {
  let message = isUpdate ? "✅ <b>ปรับปรุงข้อมูลเรียบร้อยแล้ว</b>\n\n" : "<b>📑 สรุปรายการจาก Invoice</b>\n\n";
  const validItems = items.filter(i => !i.isNew);
  const newItems = items.filter(i => i.isNew);

  items.forEach((item, index) => {
    const status = item.isNew ? "🔴 [ใหม่]" : "🔵 [ตรงสต๊อก]";
    message += `${index + 1}. ${status} <b>${item.masterName}</b>\n`;
    message += `   Lot: <code>${item.lotNo}</code> | EXP: <code>${item.expDate}</code>\n`;
    message += `   จำนวน: <b>${item.qty}</b>\n\n`;
  });

  if (newItems.length > 0) {
    message += "⚠️ <i>พบรายการใหม่ที่ไม่อยู่ในระบบ (สีแดง) รายการเหล่านี้จะไม่ถูกบันทึก</i>\n\n";
  }
  
  message += "💡 <i>หากข้อมูลผิด พิมพ์บอกให้บอทแก้ได้เลย เช่น \"รายการที่ 1 แก้เป็น 50\"</i>";

  const keyboard = {
    inline_keyboard: [
      [
        { text: "📥 ยืนยันรับเข้าสต๊อก (" + validItems.length + " รายการ)", callback_data: JSON.stringify({ a: "rec" }) }
      ],
      [
        { text: "❌ ยกเลิก", callback_data: JSON.stringify({ a: "can" }) }
      ]
    ]
  };

  sendTelegramMessage(chatId, message, keyboard);
}

function handleTelegramCallback(callback) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const callbackData = JSON.parse(callback.callback_data);
  const token = getTelegramBotToken();

  // Answer callback to stop loading state in Telegram
  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery?callback_query_id=${callback.id}`);

  if (callbackData.a === 'rec') {
    try {
      const items = getPendingInvoice(chatId);
      if (!items) {
        sendTelegramMessage(chatId, "❌ ข้อมูลหมดอายุหรือถูกลบไปแล้ว กรุณาส่งรูปใหม่");
        return;
      }

      const batchItems = items.filter(i => !i.isNew).map(i => ({
        itemId: i.itemId,
        lotNo: i.lotNo,
        expDate: i.expDate,
        qty: i.qty
      }));

      const res = receiveBatch(batchItems, "SYSTEM_BOT");
      
      if (res.success) {
        editTelegramMessage(chatId, messageId, `✅ <b>บันทึกสำเร็จ!</b>\nรับเข้าทั้งหมด ${batchItems.length} รายการ เรียบร้อยแล้ว`);
        clearPendingInvoice(chatId);
      } else {
        sendTelegramMessage(chatId, `❌ บันทึกไม่สำเร็จ: ${res.message}`);
      }
    } catch (e) {
      sendTelegramMessage(chatId, `❌ Error: ${e.message}`);
    }
  } else if (callbackData.a === 'can') {
    editTelegramMessage(chatId, messageId, "❌ ยกเลิกการทำรายการแล้ว");
    clearPendingInvoice(chatId);
  }
}

function editTelegramMessage(chatId, messageId, text) {
  const token = getTelegramBotToken();
  const url = `https://api.telegram.org/bot${token}/editMessageText`;
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: "HTML"
  };
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };
  UrlFetchApp.fetch(url, options);
}

/**
 * 🛠️ [One-time Setup] Run this function once from GAS IDE to link your bot to this script
 */
function setTelegramWebhook() {
  const token = "8976064149:AAGtOWK-YvwJJvCqOPYZ8bQoEt9BtvFiKiw";
  const webAppUrl = "https://script.google.com/macros/s/AKfycbwW_ekShYsT3HLtLLYDvW-jUnwdU4xlJGCVFoVlGvIHCYBRHRfFAQg1ScaN2mcDp2LV/exec";
  
  const url = "https://api.telegram.org/bot" + token + "/setWebhook?url=" + webAppUrl;
  
  Logger.log("กำลังส่งคำขอไปที่: " + url);
  
  try {
    const res = UrlFetchApp.fetch(url);
    Logger.log("ผลลัพธ์จาก Telegram: " + res.getContentText());
    return res.getContentText();
  } catch (e) {
    Logger.log("Error: " + e.message);
    return e.message;
  }
}

// Modify checkAccess to support internal SYSTEM_BOT token
function checkAccess(token, requiredRoles) {
  
  const session = validateSession(token);
  if (!session.success) throw new Error(session.message || 'กรุณาเข้าสู่ระบบ');
  if (!requiredRoles.includes(session.user.role)) throw new Error('คุณไม่มีสิทธิ์ทำรายการนี้');
  return session.user;
}