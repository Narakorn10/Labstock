/**
 * 🧪 Mock Data for Development
 */
export const MOCK_DATA = {
    settings: { 
        reagentTypes: ['สารเคมีทั่วไป', 'สารละลาย', 'สารชีวภาพ', 'วัสดุสิ้นเปลือง'], 
        jobTypes: ['เคมีคลินิก', 'โลหิตวิทยา', 'ภูมิคุ้มกันวิทยา', 'จุลชีววิทยา'], 
        machineTypes: ['เครื่อง Auto A', 'เครื่อง Auto B', 'Manual', 'อื่นๆ'] 
    },
    master: [
        { 
            itemId: 'CHEM-001', 
            qrCode: '089123456789', 
            name: 'Ethanol 95%', 
            reagentType: 'สารละลาย', 
            jobType: 'เคมีคลินิก', 
            machineType: 'Manual', 
            unit: 'ml', 
            minThreshold: 500, 
            weeklyTarget: 1000, 
            quantity: 800, 
            lots: [{ rowIndex: 2, lotNo: 'L01', expDate: '2025-12-31', qty: 800 }] 
        },
        { 
            itemId: 'BIO-001', 
            qrCode: 'BIO-TEST', 
            name: 'Taq Polymerase', 
            reagentType: 'สารชีวภาพ', 
            jobType: 'ภูมิคุ้มกันวิทยา', 
            machineType: 'เครื่อง Auto A', 
            unit: 'tubes', 
            minThreshold: 10, 
            weeklyTarget: 5, 
            quantity: 2, 
            lots: [{ rowIndex: 3, lotNo: 'B01', expDate: '2024-05-01', qty: 2 }] 
        }
    ],
    logs: [
        { 
            timestamp: new Date().toISOString(), 
            itemId: 'CHEM-001', 
            name: 'Ethanol 95%', 
            lotNo: 'L01', 
            action: 'รับเข้าสต๊อกหลัก', 
            qty: 800, 
            user: 'Mock Admin' 
        }
    ]
};

/**
 * Simulates GAS Method calls during development
 */
export const handleMockCall = (method, args) => {
    console.warn(`[Local Dev] Method "${method}" called with mock data.`);
    return new Promise((resolve) => {
        setTimeout(() => {
            switch(method) {
                case 'getSettings': resolve(MOCK_DATA.settings); break;
                case 'getDashboardData': resolve(MOCK_DATA.master); break;
                case 'getReagentWithLots': 
                    const qr = args[0] ? args[0].toLowerCase() : '';
                    const found = MOCK_DATA.master.find(m => 
                        (m.qrCode||'').toLowerCase().includes(qr) || 
                        (m.itemId||'').toLowerCase().includes(qr) || 
                        (m.name||'').toLowerCase().includes(qr)
                    );
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
    });
};