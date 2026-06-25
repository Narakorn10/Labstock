import Link from 'next/link';
import { ArrowRight, Camera, HandHelping, PackagePlus } from 'lucide-react';

export default function MobileHomePage() {
  return (
    <div className="min-h-screen bg-[#f5f7f9]">
      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 space-y-3">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Standalone Mobile Surface</p>
          <h1 className="text-3xl font-black text-gray-900">LabStock Mobile</h1>
          <p className="text-sm font-medium text-gray-500">
            Fast scanner-first workflow for receiving and dispensing with large controls and fewer steps.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Link
            href="/mobile/receive"
            className="bg-green-600 text-white rounded-[2rem] p-6 shadow-sm min-h-40 flex flex-col justify-between"
          >
            <div className="w-14 h-14 rounded-[1.25rem] bg-white/15 flex items-center justify-center">
              <PackagePlus size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-black">Receive</h2>
              <p className="text-sm font-medium text-green-100">Scan incoming stock, edit lot and expiry, then submit.</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-widest">
              Open <ArrowRight size={16} />
            </div>
          </Link>

          <Link
            href="/mobile/dispense"
            className="bg-red-600 text-white rounded-[2rem] p-6 shadow-sm min-h-40 flex flex-col justify-between"
          >
            <div className="w-14 h-14 rounded-[1.25rem] bg-white/15 flex items-center justify-center">
              <HandHelping size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-black">Dispense</h2>
              <p className="text-sm font-medium text-red-100">Scan, keep FEFO by default, switch lots when needed, then confirm.</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-widest">
              Open <ArrowRight size={16} />
            </div>
          </Link>
        </div>

        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Camera size={24} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-black text-gray-900">Same login, simpler flow</p>
            <p className="text-sm font-medium text-gray-500">
              This mobile surface reuses the current auth and inventory APIs. No backend stock logic was changed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
