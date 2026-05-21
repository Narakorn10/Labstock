import React, { useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const QRScanner = ({ onScan, onCancel }) => {
    useEffect(() => {
        // เพิ่มระบบเสียง Beep เพื่อความเร็วในการทำงาน
        const beep = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3");
        
        const scanner = new Html5Qrcode("qr-reader-react");
        const config = { 
            fps: 25, // เพิ่มเฟรมเรตเพื่อให้จับภาพได้ไวขึ้น
            // เลิกใช้ qrbox แบบระบุขนาดเพื่อให้สแกนได้ทั้งหน้าจอ (เหมาะกับ QR เล็กๆ)
            // หรือใช้ qrbox ขนาดใหญ่เพื่อให้ผู้ใช้เล็งได้ง่ายขึ้น
            qrbox: (viewfinderWidth, viewHeight) => {
                const minEdge = Math.min(viewfinderWidth, viewHeight);
                return { width: minEdge * 0.8, height: minEdge * 0.8 }; 
            },
            aspectRatio: 1.0,
            videoConstraints: {
                facingMode: "environment",
                width: { ideal: 1920 }, // บังคับความละเอียดสูงเพื่อให้เห็นรายละเอียด QR เล็กๆ
                height: { ideal: 1080 }
            }
        };

        scanner.start(
            { facingMode: "environment" }, 
            config, 
            (txt) => { 
                beep.play().catch(() => {}); 
                scanner.stop().then(() => onScan(txt)); 
            },
            (err) => {}
        ).catch(err => { console.error(err); });

        // พยายามเปิด Zoom (สำหรับมือถือที่รองรับ) หลังจากกล้องเริ่มทำงาน
        setTimeout(() => {
            const track = scanner.getVideoTrack();
            if (track && track.getCapabilities && track.getCapabilities().zoom) {
                track.applyConstraints({ advanced: [{ zoom: 2.0 }] }).catch(e => console.warn("Zoom not supported", e));
            }
        }, 2000);

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
