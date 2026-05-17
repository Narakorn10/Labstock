import React, { useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const QRScanner = ({ onScan, onCancel }) => {
    useEffect(() => {
        // เพิ่มระบบเสียง Beep เพื่อความเร็วในการทำงาน
        const beep = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3");
        
        const scanner = new Html5Qrcode("qr-reader-react");
        const config = { 
            fps: 20, // เพิ่มเฟรมเรตเป็น 20 เพื่อให้แสกนไวขึ้น
            qrbox: (viewfinderWidth, viewHeight) => {
                // ปรับขนาดกรอบแสกนให้พอดีกับมือถือที่สุด
                const minEdge = Math.min(viewfinderWidth, viewHeight);
                const size = Math.floor(minEdge * 0.7);
                return { width: size, height: size * 0.6 }; // กรอบสี่เหลี่ยมผืนผ้าสำหรับบาร์โค้ดน้ำยา
            },
            aspectRatio: 1.0
        };

        scanner.start(
            { facingMode: "environment" }, 
            config, 
            (txt) => { 
                beep.play().catch(() => {}); // ส่งเสียงเตือน
                scanner.stop().then(() => onScan(txt)); 
            },
            (err) => {}
        ).catch(err => { console.error(err); });

        return () => { if (scanner.isScanning) scanner.stop().catch(()=>{}); };
    }, [onScan]);

    return (
        <div className="mb-6 animate-fade-in bg-slate-900 p-4 rounded-2xl">
            <div id="qr-reader-react" className="qr-reader w-full max-w-sm mx-auto overflow-hidden rounded-xl border-2 border-blue-500/30"></div>
            <div className="text-center mt-3 text-blue-400 text-[10px] font-bold uppercase tracking-widest animate-pulse">Scanning...</div>
            <button type="button" onClick={onCancel} className="mt-4 w-full bg-slate-800 text-white py-3.5 rounded-xl font-medium active-scale"><i className="fa-solid fa-xmark mr-2"></i>ยกเลิกกล้อง</button>
        </div>
    );
};

export default QRScanner;
