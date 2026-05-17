import React, { useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const QRScanner = ({ onScan, onCancel }) => {
    useEffect(() => {
        const scanner = new Html5Qrcode("qr-reader-react");
        scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, 
            (txt) => { scanner.stop().then(() => onScan(txt)); },
            (err) => {}
        ).catch(err => { console.error(err); });
        return () => { if (scanner.isScanning) scanner.stop().catch(()=>{}); };
    }, [onScan]);

    return (
        <div className="mb-6 animate-fade-in bg-slate-900 p-4 rounded-2xl">
            <div id="qr-reader-react" className="qr-reader w-full max-w-sm mx-auto overflow-hidden rounded-xl"></div>
            <button type="button" onClick={onCancel} className="mt-4 w-full bg-slate-800 text-white py-3 rounded-xl font-medium active-scale"><i className="fa-solid fa-xmark mr-2"></i>ยกเลิกกล้อง</button>
        </div>
    );
};

export default QRScanner;
