'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, RotateCcw, CheckCircle } from 'lucide-react';

interface QRScannerProps {
  onScan: (text: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [isScannerStarted, setIsScannerStarted] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // New state to prevent duplicate scans
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerId = "qr-reader";

  useEffect(() => {
    const startScanner = async () => {
      try {
        const scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;

        const config = {
          fps: 60, // Keep 60fps for focus, but we'll debounce the result
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            // Increase box size to 80% to give more room for small codes
            const boxSize = Math.floor(minEdge * 0.8);
            return { width: boxSize, height: boxSize };
          },
          aspectRatio: 1.0,
          disableFlip: true, // Speed up processing
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.DATA_MATRIX
          ]
        };

        // Beep Sound Generator
        const playBeep = () => {
          try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.2);
          } catch (e) {
            console.warn("Audio feedback not supported", e);
          }
        };

        await scanner.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            // Prevent multiple scans of the same item in rapid succession
            setIsProcessing(prev => {
              if (prev) return true; // Already processing, ignore this frame
              
              setIsSuccess(true);
              playBeep();
              if (navigator.vibrate) navigator.vibrate(100);
              
              // Brief delay to show success state before callback
              setTimeout(() => {
                onScan(decodedText);
              }, 500); // Increased slightly for clarity
              
              return true;
            });
          },
          () => {
            // Successively ignored errors to keep scanner running
          }
        );

        setIsScannerStarted(true);
      } catch (err) {
        const error = err as Error;
        console.error("Scanner Error:", error);
        setError("ไม่สามารถเปิดกล้องได้: " + error.message);
      }
    };

    startScanner();

    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(err => console.error("Error stopping scanner:", err));
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col items-center justify-center p-4">
      <div className={`w-full max-w-lg aspect-square bg-gray-900 rounded-3xl overflow-hidden relative shadow-2xl border-2 transition-all duration-300 ${isSuccess ? 'border-green-500' : 'border-white/20'}`}>
        <div id={scannerId} className="w-full h-full" />
        
        {/* Success Overlay */}
        {isSuccess && (
          <div className="absolute inset-0 flex items-center justify-center bg-green-500/20 backdrop-blur-sm animate-in fade-in duration-200">
            <CheckCircle className="text-green-500" size={80} />
          </div>
        )}

        {/* Scanning Overlay (Visual only) */}
        {!error && isScannerStarted && !isSuccess && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[250px] h-[250px] border-2 border-blue-500 rounded-lg animate-pulse">
              <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-white"></div>
              <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-white"></div>
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-white"></div>
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-white"></div>
              {/* Laser line effect */}
              <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] animate-[scan_2s_ease-in-out_infinite]"></div>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-white p-6 text-center">
            <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mb-4 text-3xl font-bold italic">!</div>
            <p className="mb-6">{error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-white text-black rounded-full font-bold flex items-center gap-2"
            >
              <RotateCcw size={18} />
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-col items-center gap-4 w-full">
        <p className="text-white/60 text-sm font-medium animate-pulse">
          Position the barcode inside the frame
        </p>
        
        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="w-16 h-16 bg-white/10 text-white rounded-full flex items-center justify-center hover:bg-white/20 transition-colors backdrop-blur-md border border-white/10"
          >
            <X size={32} />
          </button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes scan {
          0%, 100% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          50% { top: 100%; opacity: 1; }
          90% { opacity: 1; }
          95% { opacity: 0; }
        }
        #qr-reader__scan_region video {
          object-fit: cover !important;
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
    </div>
  );
}
