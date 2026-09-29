'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, CheckCircle, RotateCcw, X } from 'lucide-react';

interface QRScannerProps {
  onScan: (text: string) => void;
  onClose: () => void;
  /** "mobile" uses the dark full-screen layout of the mobile/LINE redesign. Scanning behaviour is identical. */
  variant?: 'default' | 'mobile';
  /** Heading shown in the mobile layout, e.g. "รับเข้าคลังหลัก". */
  title?: string;
}

type CameraDevice = Awaited<ReturnType<typeof Html5Qrcode.getCameras>>[number];

const scannerId = 'qr-reader';
const savedCameraKey = 'labstock.preferredCameraId';

function getPreferredCamera(cameras: CameraDevice[]) {
  const savedCameraId = typeof window !== 'undefined' ? localStorage.getItem(savedCameraKey) : null;
  const savedCamera = cameras.find((camera) => camera.id === savedCameraId);
  if (savedCamera && !/macro/i.test(savedCamera.label || '')) return savedCamera;

  const backCamera = cameras.find((camera) => (
    /(back|rear|environment)/i.test(camera.label || '') && !/macro/i.test(camera.label || '')
  ));
  if (backCamera) return backCamera;

  const macroCamera = cameras.find((camera) => /macro/i.test(camera.label || ''));
  if (macroCamera) return macroCamera;

  return cameras[cameras.length - 1];
}

function getScannerConfig() {
  return {
    fps: 15,
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

async function enableContinuousFocus(scanner: Html5Qrcode) {
  try {
    const capabilities = scanner.getRunningTrackCapabilities() as MediaTrackCapabilities & {
      focusMode?: string[];
    };

    if (!capabilities.focusMode?.includes('continuous')) return;

    await scanner.applyVideoConstraints({
      advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
    });
  } catch (error) {
    // Some mobile browsers do not expose focus controls. Scanning still works with their default focus mode.
    console.info('Continuous camera focus is not available on this device', error);
  }
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

export default function QRScanner({ onScan, onClose, variant = 'default', title }: QRScannerProps) {
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

        await enableContinuousFocus(scanner);

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

  if (variant === 'mobile') {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col bg-[#0d1116] text-white">
        <div className="flex items-center gap-3 px-[18px] pb-2 pt-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดกล้อง"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/[0.12]"
          >
            <X size={20} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-xs tracking-[0.14em] text-[#9aa3ad]">สแกนก่อน</p>
            <p className="truncate font-semibold">{title || 'สแกนบาร์โค้ด'}</p>
          </div>
          <span className="size-11 shrink-0" aria-hidden="true" />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-[18px]">
          <div className={`relative aspect-square w-full max-w-md overflow-hidden rounded-[22px] bg-[#161b22] transition-colors ${isSuccess ? 'ring-4 ring-[oklch(0.7_0.17_150)]' : 'ring-1 ring-white/20'}`}>
            <div id={scannerId} className="h-full w-full" />

            {isSuccess && (
              <div className="absolute inset-0 flex items-center justify-center bg-[oklch(0.7_0.17_150)]/25 backdrop-blur-sm">
                <CheckCircle className="text-[oklch(0.7_0.17_150)]" size={72} />
              </div>
            )}

            {!error && isScannerStarted && !isSuccess && !isProcessing && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-[170px] w-[260px] rounded-[22px] border-[3px] border-white shadow-[0_0_0_2000px_rgba(13,17,22,0.45)]">
                  <div className="absolute inset-x-3.5 top-0 h-0.5 animate-[scan_2s_ease-in-out_infinite] bg-[oklch(0.7_0.17_150)] shadow-[0_0_12px_oklch(0.7_0.17_150)]" />
                </div>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#161b22] p-6 text-center">
                <p className="text-sm">{error}</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex min-h-11 items-center gap-2 rounded-full bg-white px-6 font-medium text-[#1d1f20]"
                >
                  <RotateCcw size={18} />
                  ลองใหม่
                </button>
              </div>
            )}
          </div>

          <p className="text-[13px] text-[#c7ced6]">วางบาร์โค้ด GS1 หรือ QR ให้อยู่ในกรอบ</p>

          {cameras.length > 1 && (
            <label className="w-full max-w-md">
              <span className="mb-1.5 flex items-center gap-2 text-xs text-[#9aa3ad]">
                <Camera size={14} />
                เลือกกล้อง
              </span>
              <select
                value={selectedCameraId}
                onChange={(event) => handleCameraChange(event.target.value)}
                disabled={isProcessing || isSuccess}
                className="min-h-11 w-full rounded-xl border border-white/10 bg-white/10 px-3 text-sm text-white outline-none disabled:opacity-50"
              >
                {cameras.map((camera, index) => (
                  <option key={camera.id} value={camera.id} className="text-gray-900">
                    {camera.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
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
