const MOCK_DATA = {
    settings: { reagentTypes: ['สารเคมีทั่วไป', 'สารละลาย', 'สารชีวภาพ', 'วัสดุสิ้นเปลือง'], jobTypes: ['เคมีคลินิก', 'โลหิตวิทยา', 'ภูมิคุ้มกันวิทยา', 'จุลชีววิทยา'], machineTypes: ['เครื่อง Auto A', 'เครื่อง Auto B', 'Manual', 'อื่นๆ'] },
    master: [
        { itemId: 'CHEM-001', qrCode: '089123456789', name: 'Ethanol 95%', reagentType: 'สารละลาย', jobType: 'เคมีคลินิก', machineType: 'Manual', unit: 'ml', minThreshold: 500, weeklyTarget: 1000, quantity: 800, lots: [{ rowIndex: 2, lotNo: 'L01', expDate: '2025-12-31', qty: 800 }] },
        { itemId: 'BIO-001', qrCode: 'BIO-TEST', name: 'Taq Polymerase', reagentType: 'สารชีวภาพ', jobType: 'ภูมิคุ้มกันวิทยา', machineType: 'เครื่อง Auto A', unit: 'tubes', minThreshold: 10, weeklyTarget: 5, quantity: 2, lots: [{ rowIndex: 3, lotNo: 'B01', expDate: '2024-05-01', qty: 2 }] }
    ],
    logs: [{ timestamp: new Date().toISOString(), itemId: 'CHEM-001', name: 'Ethanol 95%', lotNo: 'L01', action: 'รับเข้าสต๊อกหลัก', qty: 800, user: 'Mock Admin' }]
};

export const gasRun = (method, ...args) => {
    return new Promise((resolve, reject) => {
        // 1. ลองใช้ Google Script Run ก่อน (ถ้าอยู่ใน GAS)
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args);
        } else {
            // 2. ถ้าอยู่ข้างนอก (เช่น Vercel) ให้ใช้ Fetch API
            const gasUrl = import.meta.env.VITE_GAS_URL;
            
            if (gasUrl) {
                console.log("Connecting to GAS at:", gasUrl.substring(0, 30) + "...");
                fetch(gasUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ method, args })
                })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
                    return res.json();
                })
                .then(resolve)
                .catch(err => {
                    console.error("❌ GAS Connection Error:", err);
                    alert("ไม่สามารถเชื่อมต่อ Google Sheets ได้\nกรุณาตรวจสอบการตั้งค่า VITE_GAS_URL และการ Deploy ใน Google Script");
                    reject(err);
                });
            } else {
                // 3. ถ้าไม่มีทั้งคู่ ให้ใช้ Mock Data (สำหรับ Developer)
                console.warn(`[Local Dev] Method "${method}" called with mock data.`);
                setTimeout(() => {
                    switch(method) {
                        case 'getSettings': resolve(MOCK_DATA.settings); break;
                        case 'getDashboardData': resolve(MOCK_DATA.master); break;
                        case 'getReagentWithLots': 
                            const qr = args[0] ? args[0].toLowerCase() : '';
                            const found = MOCK_DATA.master.find(m => (m.qrCode||'').toLowerCase().includes(qr) || (m.itemId||'').toLowerCase().includes(qr) || (m.name||'').toLowerCase().includes(qr));
                            resolve(found ? { success: true, data: found } : { success: false, message: 'ไม่พบข้อมูลในระบบ' });
                            break;
                        case 'getLogs': resolve(MOCK_DATA.logs); break;
                        case 'getAllLogsForExport': resolve([[new Date().toLocaleString(), 'CHEM-001', 'Ethanol 95%', 'L01', 'รับเข้า', 800, 'Admin']]); break;
                        case 'clearLogs': MOCK_DATA.logs = []; resolve({ success: true, message: 'ล้างประวัติสำเร็จ' }); break;
                        case 'setupSystem': resolve({ success: true, message: 'ตั้งค่าระบบสำเร็จ' }); break;
                        case 'receiveBatch': 
                        case 'dispenseBatch': resolve({ success: true, message: `ทำรายการสำเร็จ` }); break;
                        case 'addMasterItem': 
                        case 'updateMasterItem': resolve({ success: true, message: `อัปเดตข้อมูลสำเร็จ` }); break;
                        default: resolve({ success: true, message: `Success` });
                    }
                }, 400);
            }
        }
    });
};

export const parseGS1Lot = (text) => {
    if(!text) return null;
    const match = text.match(/\(10\)([^()]+)/);
    return match ? match[1].trim() : null;
};
