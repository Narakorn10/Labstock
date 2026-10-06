'use client';

import { useMemo } from 'react';
import QRCode from 'qrcode';
import { buildLotLabelPayload } from '@/lib/lot-label';

export const LABEL_WIDTH_MM = 50;
export const LABEL_HEIGHT_MM = 35;

export interface LotLabelProps {
  itemId: string;
  name: string;
  lotNo: string;
  expDate: string;
}

function formatExp(expDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(expDate || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '-';
}

/** QR drawn as one SVG path from the module matrix: crisp on 203 dpi thermal heads, no innerHTML. */
function QrSvg({ value, sizeMm }: { value: string; sizeMm: number }) {
  const { path, viewSize } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const quiet = 1;
    let d = '';
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (qr.modules.get(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
      }
    }
    return { path: d, viewSize: size + quiet * 2 };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm`, flexShrink: 0 }}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR Code"
    >
      <rect width={viewSize} height={viewSize} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** One 50x35 mm sticker: name across the top, QR on the left, Lot/EXP on the right. */
export function LotLabel({ itemId, name, lotNo, expDate }: LotLabelProps) {
  const payload = buildLotLabelPayload({ itemId, lotNo, expDate });
  const lotFontPt = lotNo.length > 14 ? 7 : lotNo.length > 10 ? 8 : 9.5;

  return (
    <div
      className="lot-label"
      style={{
        width: `${LABEL_WIDTH_MM}mm`,
        height: `${LABEL_HEIGHT_MM}mm`,
        padding: '1.5mm',
        boxSizing: 'border-box',
        background: '#fff',
        color: '#000',
        fontFamily: 'Arial, "Noto Sans Thai", "Leelawadee UI", sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.8mm',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          fontSize: '7.5pt',
          fontWeight: 700,
          lineHeight: 1.15,
          maxHeight: '2.3em',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          wordBreak: 'break-word'
        }}
      >
        {name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5mm', flex: 1, minHeight: 0 }}>
        <QrSvg value={payload} sizeMm={24} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2mm', minWidth: 0, flex: 1 }}>
          <div>
            <div style={{ fontSize: '6pt' }}>LOT</div>
            <div style={{ fontSize: `${lotFontPt}pt`, fontWeight: 700, lineHeight: 1.1, wordBreak: 'break-all' }}>{lotNo}</div>
          </div>
          <div>
            <div style={{ fontSize: '6pt' }}>EXP</div>
            <div style={{ fontSize: '9.5pt', fontWeight: 700, lineHeight: 1.1 }}>{formatExp(expDate)}</div>
          </div>
          <div style={{ fontSize: '6pt', lineHeight: 1.1, wordBreak: 'break-all' }}>{itemId}</div>
        </div>
      </div>
    </div>
  );
}
