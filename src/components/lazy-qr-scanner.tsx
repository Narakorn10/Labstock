"use client";

import dynamic from "next/dynamic";

const LazyQRScanner = dynamic(() => import("@/components/qr-scanner"), {
  ssr: false,
});

export default LazyQRScanner;
