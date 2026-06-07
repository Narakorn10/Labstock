'use client';

import { useState, useMemo } from 'react';
import Modal from './modal';
import { useExport } from '@/hooks/use-export';
import MultiSelect from './multi-select';
import { 
  FileSpreadsheet, 
  FileText, 
  Share2, 
  Image as ImageIcon, 
  ChevronDown,
  AlertTriangle,
  LayoutList,
  Database
} from 'lucide-react';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: any[];
  jobTypes: string[];
}

export default function ReportModal({ isOpen, onClose, data, jobTypes }: ReportModalProps) {
  const [reportType, setReportType] = useState('order'); // 'order' or 'all'
  const [selectedJobs, setSelectedJobs] = useState<string[]>(['ALL']);

  const filteredReportData = useMemo(() => {
    let result = data;
    if (reportType === 'order') {
      result = result.filter(i => i.quantity <= i.minThreshold);
    }
    if (!selectedJobs.includes('ALL')) {
      result = result.filter(i => selectedJobs.includes(i.jobType));
    }
    return result;
  }, [data, reportType, selectedJobs]);

  const jobSummaryText = useMemo(() => {
    if (selectedJobs.includes('ALL')) return 'ทุกแผนก';
    return selectedJobs.join(', ');
  }, [selectedJobs]);

  const { reportRef, exportCSV, printPDF, nativeShare, exportImage } = useExport(
    filteredReportData, 
    reportType, 
    jobSummaryText
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="สร้างรายงานสรุปสต๊อก" maxWidth="max-w-2xl">
      <div className="space-y-8">
        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">ประเภทรายงาน</label>
            <div className="relative">
              <select 
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold appearance-none outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="order">⚠️ รายการที่ต้องสั่งซื้อ</option>
                <option value="all">📊 ยอดคงเหลือทั้งหมด</option>
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
            </div>
          </div>

          <div className="space-y-0">
            <MultiSelect 
              label="กรองตามแผนก" 
              options={jobTypes} 
              selected={selectedJobs} 
              onChange={setSelectedJobs} 
            />
          </div>
        </div>

        {/* Report Preview */}
        <div className="border border-gray-100 rounded-[2.5rem] overflow-hidden bg-gray-50/50 shadow-inner">
           <div ref={reportRef} className="bg-white p-8 sm:p-12">
              <div className="flex justify-between items-start mb-8 border-b border-gray-50 pb-8">
                <div>
                  <h3 className="text-2xl font-black text-gray-900 tracking-tight">
                    {reportType === 'order' ? 'รายการที่ต้องสั่งซื้อเพิ่ม' : 'สรุปยอดคงเหลือสต๊อก'}
                  </h3>
                  <div className="flex flex-col gap-1 mt-2">
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2">
                        <LayoutList size={14} className="text-blue-500" />
                        {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                    <p className="text-[10px] text-blue-500 font-black uppercase tracking-tight">
                        แผนก: {jobSummaryText}
                    </p>
                  </div>
                </div>
                <div className="w-16 h-16 bg-blue-600 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl shadow-blue-100">
                  <Database size={32} />
                </div>
              </div>

              <div className="space-y-4">
                {filteredReportData.map((item) => (
                  <div key={item.itemId} className="flex justify-between items-center border-b border-gray-50 pb-4 last:border-0 last:pb-0">
                    <div className="min-w-0 pr-6">
                      <p className="text-base font-black text-gray-800 truncate">{item.name}</p>
                      <div className="flex gap-2 mt-1">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">ID: {item.itemId}</span>
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter bg-blue-50/50 px-1.5 py-0.5 rounded-lg">{item.jobType}</span>
                      </div>
                    </div>
                    <div className={`px-4 py-2 rounded-2xl text-sm font-black whitespace-nowrap shadow-sm ${item.quantity <= item.minThreshold ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-gray-50 text-gray-600 border border-gray-100'}`}>
                      {item.quantity} <span className="text-xs opacity-60 font-bold ml-1">{item.unit}</span>
                    </div>
                  </div>
                ))}
                {filteredReportData.length === 0 && (
                  <div className="py-10 text-center text-gray-400 italic text-sm font-bold">
                    ไม่มีรายการตามที่ระบุ
                  </div>
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-50 text-center">
                 <p className="text-[8px] text-gray-300 font-bold uppercase tracking-[0.2em]">Generated by LabStock Smart System</p>
              </div>
           </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button 
            onClick={nativeShare}
            className="flex items-center justify-center gap-2 p-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95"
          >
            <Share2 size={16} />
            แชร์เข้า LINE
          </button>
          <button 
            onClick={exportImage}
            className="flex items-center justify-center gap-2 p-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
          >
            <ImageIcon size={16} />
            เซฟเป็นรูปภาพ
          </button>
          <button 
            onClick={exportCSV}
            className="flex items-center justify-center gap-2 p-4 bg-emerald-50 text-emerald-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-100 transition-all"
          >
            <FileSpreadsheet size={16} />
            Excel (CSV)
          </button>
          <button 
            onClick={printPDF}
            className="flex items-center justify-center gap-2 p-4 bg-red-50 text-red-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-100 transition-all"
          >
            <FileText size={16} />
            พิมพ์ PDF
          </button>
        </div>
      </div>
    </Modal>
  );
}
