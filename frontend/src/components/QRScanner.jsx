import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const QRScanner = ({ onScan, onCancel }) => {
    const scannerRef = useRef(null);
    const [capabilities, setCapabilities] = useState(null);
    const [torchOn, setTorchOn] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(1);

    useEffect(() => {
        const beep = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3");
        const scanner = new Html5Qrcode("qr-reader-react");
        scannerRef.current = scanner;

        const config = { 
            fps: 30,
            qrbox: (viewfinderWidth, viewHeight) => {
                const minEdge = Math.min(viewfinderWidth, viewHeight);
                // ขยายกล่องให้ใหญ่ขึ้นนิดหน่อยเพื่อให้มองเห็นรอบๆ ง่ายขึ้น
                return { width: minEdge * 0.75, height: minEdge * 0.75 }; 
            },
            aspectRatio: 1.0
        };

        const startScanner = async () => {
            try {
                await scanner.start(
                    { facingMode: "environment" }, 
                    config, 
                    (txt) => { 
                        beep.play().catch(() => {}); 
                        scanner.stop().then(() => onScan(txt)); 
                    },
                    () => {}
                );

                // ตรวจสอบความสามารถของกล้อง (Zoom, Torch, Focus)
                const track = scanner.getVideoTrack();
                const caps = track.getCapabilities();
                setCapabilities(caps);

                // ตั้งค่า Focus เริ่มต้นเป็น Continuous ถ้าทำได้
                const constraints = { advanced: [] };
                if (caps.focusMode && caps.focusMode.includes('continuous')) {
                    constraints.advanced.push({ focusMode: 'continuous' });
                }
                
                // เริ่มต้น Zoom ที่ 2.0x สำหรับ QR ขนาดเล็ก (ถ้าเครื่องรองรับ)
                if (caps.zoom) {
                    const initialZoom = Math.min(2.0, caps.zoom.max);
                    constraints.advanced.push({ zoom: initialZoom });
                    setZoomLevel(initialZoom);
                }

                if (constraints.advanced.length > 0) {
                    track.applyConstraints(constraints).catch(e => console.warn("Apply constraints error", e));
                }

            } catch (err) {
                console.error("Scanner start error", err);
            }
        };

        startScanner();

        return () => {
            if (scanner.isScanning) {
                scanner.stop().catch(e => console.error("Scanner stop error", e));
            }
        };
    }, [onScan]);

    const toggleTorch = async () => {
        try {
            const track = scannerRef.current?.getVideoTrack();
            if (track && capabilities?.torch) {
                const newState = !torchOn;
                await track.applyConstraints({ advanced: [{ torch: newState }] });
                setTorchOn(newState);
            }
        } catch (e) {
            console.error("Torch error", e);
        }
    };

    const handleZoom = async (level) => {
        try {
            const track = scannerRef.current?.getVideoTrack();
            if (track && capabilities?.zoom) {
                const val = Math.min(Math.max(level, capabilities.zoom.min), capabilities.zoom.max);
                await track.applyConstraints({ advanced: [{ zoom: val }] });
                setZoomLevel(val);
            }
        } catch (e) {
            console.error("Zoom error", e);
        }
    };

    return (
        <div className="mb-6 animate-fade-in bg-slate-900 p-4 rounded-3xl overflow-hidden shadow-2xl border border-white/10">
            <div id="qr-reader-react" className="qr-reader w-full max-w-sm mx-auto overflow-hidden rounded-2xl border-2 border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.3)]"></div>
            
            {/* 🎮 Controls Overlay */}
            <div className="mt-4 flex items-center justify-between gap-3 px-2">
                <div className="flex gap-2">
                    {capabilities?.torch && (
                        <button 
                            type="button" 
                            onClick={toggleTorch}
                            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${torchOn ? 'bg-amber-400 text-slate-900 shadow-[0_0_15px_rgba(251,191,36,0.5)]' : 'bg-slate-800 text-white'}`}
                        >
                            <i className={`fa-solid ${torchOn ? 'fa-lightbulb' : 'fa-lightbulb'}`}></i>
                        </button>
                    )}
                    
                    {capabilities?.zoom && (
                        <div className="flex bg-slate-800 rounded-xl p-1 items-center">
                            {[1, 2, 3].map(z => (
                                <button
                                    key={z}
                                    type="button"
                                    onClick={() => handleZoom(z)}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${Math.round(zoomLevel) === z ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
                                >
                                    {z}x
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="text-right">
                    <div className="text-blue-400 text-[10px] font-bold uppercase tracking-widest animate-pulse">Scanning...</div>
                    <div className="text-slate-500 text-[8px] mt-0.5">ขยับ QR ให้อยู่ในกรอบ</div>
                </div>
            </div>

            <button 
                type="button" 
                onClick={onCancel} 
                className="mt-5 w-full bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white py-3.5 rounded-2xl font-bold transition-all active-scale border border-red-500/20"
            >
                <i className="fa-solid fa-xmark mr-2"></i>ยกเลิกกล้อง
            </button>
        </div>
    );
};

export default QRScanner;
