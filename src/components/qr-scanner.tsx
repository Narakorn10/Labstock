'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, CheckCircle, RotateCcw, X } from 'lucide-react';

interface QRScannerProps {
  onScan: (text: string) => void;
  onClose: () => void;
}

type CameraDevice = Awaited<ReturnType<typeof Html5Qrcode.getCameras>>[number];

const scannerId = 'qr-reader';
const savedCameraKey = 'labstock.preferredCameraId';

function getPreferredCamera(cameras: CameraDevice[]) {
  const savedCameraId = typeof window !== 'undefined' ? localStorage.getItem(savedCameraKey) : null;
  const savedCamera = cameras.find((camera) => camera.id === savedCameraId);
  if (savedCamera) return savedCamera;

  const macroCamera = cameras.find((camera) => /macro/i.test(camera.label || ''));
  if (macroCamera) return macroCamera;

  const backCamera = cameras.find((camera) => /(back|rear|environment)/i.test(camera.label || ''));
  return backCamera || cameras[cameras.length - 1];
}

function getScannerConfig() {
  return {
    fps: 60,
    qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const boxSize = Math.floor(minEdge * 0.8);
      return { width: boxSize, height: boxSize };
    },
    aspectRatio: 1.0,
    disableFlip: true,
    formatsToSupport: [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
    ],
  };
}

function playBeep() {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) return;

    const audioCtx = new AudioContextCtor();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
    gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.2);
  } catch (error) {
    console.warn('Audio feedback not supported', error);
  }
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [isScannerStarted, setIsScannerStarted] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [cameraLookupDone, setCameraLookupDone] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCameras = async () => {
      try {
        const availableCameras = await Html5Qrcode.getCameras();
        if (cancelled) return;

        setCameras(availableCameras);
        const preferredCamera = getPreferredCamera(availableCameras);
        if (preferredCamera) {
          setSelectedCameraId(preferredCamera.id);
        }
      } catch (err) {
        console.warn('Unable to list cameras, falling back to environment camera', err);
      } finally {
        if (!cancelled) {
          setCameraLookupDone(true);
        }
      }
    };

    loadCameras();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cameraLookupDone) return;

    let cancelled = false;

    const startScanner = async () => {
      try {
        setError(null);
        setIsSuccess(false);
        setIsProcessing(false);
        setIsScannerStarted(false);

        const scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;

        await scanner.start(
          selectedCameraId || { facingMode: 'environment' },
          getScannerConfig(),
          (decodedText) => {
            setIsProcessing((prev) => {
              if (prev) return true;

              setIsSuccess(true);
              playBeep();
              if (navigator.vibrate) navigator.vibrate(100);

              setTimeout(() => {
                onScan(decodedText);
              }, 500);

              return true;
            });
          },
          () => {
            // Keep scanning through frames that do not decode cleanly.
          },
        );

        if (!cancelled) {
          setIsScannerStarted(true);
        }
      } catch (err) {
        if (cancelled) return;

        const scannerError = err as Error;
        console.error('Scanner Error:', scannerError);
        setError(`ไม่สามารถเปิดกล้องได้: ${scannerError.message}`);
      }
    };

    startScanner();

    return () => {
      cancelled = true;

      if (scannerRef.current?.isScanning) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current?.clear())
          .catch((err) => console.error('Error stopping scanner:', err));
      }
    };
  }, [cameraLookupDone, onScan, selectedCameraId]);

  const handleCameraChange = (cameraId: string) => {
    setSelectedCameraId(cameraId);
    localStorage.setItem(savedCameraKey, cameraId);
  };

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col items-center justify-center p-4">
      <div className={`w-full max-w-lg aspect-square bg-gray-900 rounded-3xl overflow-hidden relative shadow-2xl border-2 transition-all duration-300 ${isSuccess ? 'border-green-500' : 'border-white/20'}`}>
        <div id={scannerId} className="w-full h-full" />

        {isSuccess && (
          <div className="absolute inset-0 flex items-center justify-center bg-green-500/20 backdrop-blur-sm animate-in fade-in duration-200">
            <CheckCircle className="text-green-500" size={80} />
          </div>
        )}

        {!error && isScannerStarted && !isSuccess && !isProcessing && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[250px] h-[250px] border-2 border-blue-500 rounded-lg animate-pulse">
              <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-white"></div>
              <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-white"></div>
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-white"></div>
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-white"></div>
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
              ลองใหม่
            </button>
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-col items-center gap-4 w-full">
        {cameras.length > 1 && (
          <label className="w-full max-w-lg text-white">
            <span className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/60">
              <Camera size={14} />
              เลือกกล้อง
            </span>
            <select
              value={selectedCameraId}
              onChange={(event) => handleCameraChange(event.target.value)}
              disabled={isProcessing || isSuccess}
              className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold text-white backdrop-blur-md outline-none disabled:opacity-50"
            >
              {cameras.map((camera, index) => (
                <option key={camera.id} value={camera.id} className="text-gray-900">
                  {camera.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="text-white/60 text-sm font-medium animate-pulse">
          วางบาร์โค้ดให้อยู่ภายในกรอบ
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
