import React from 'react';
import Modal from '../Modal';
import Select2 from '../Select2';

const ReportModal = ({ 
    isOpen, onClose, reportType, setReportType, 
    settings, reportJob, setReportJob, 
    reportData, reportRef, 
    exportCSV, exportImage, printPDF, copyLine 
}) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="สร้างรายงานส่งหัวหน้า" width="max-w-2xl" headerColor="bg-slate-50" 
            actions={
                <React.Fragment>
                    <button onClick={exportCSV} className="w-full sm:w-auto py-3 px-4 bg-emerald-600 text-white rounded-xl text-sm font-medium active-scale shadow-sm transition"><i className="fa-solid fa-file-excel mr-2"></i>Excel</button>
                    <button onClick={exportImage} className="w-full sm:w-auto py-3 px-4 bg-blue-600 text-white rounded-xl text-sm font-medium active-scale shadow-sm transition"><i className="fa-solid fa-image mr-2"></i>บันทึกรูป</button>
                    <button onClick={printPDF} className="w-full sm:w-auto py-3 px-4 bg-rose-600 text-white rounded-xl text-sm font-medium active-scale shadow-sm transition"><i className="fa-solid fa-file-pdf mr-2"></i>PDF/พิมพ์</button>
                    <button onClick={copyLine} className="w-full sm:w-auto py-3 px-4 bg-slate-800 text-white rounded-xl text-sm font-medium active-scale shadow-sm transition"><i className="fa-brands fa-line mr-2"></i>คัดลอกส่ง Line</button>
                </React.Fragment>
            }>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">ประเภทรายงาน</label>
                    <select value={reportType} onChange={e => setReportType(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                        <option value="order">⚠️ เฉพาะรายการที่ต้องสั่งซื้อ</option>
                        <option value="all">📊 ยอดคงเหลือทั้งหมด</option>
                    </select>
                </div>
                <Select2 label="กรองตามประเภทงาน" options={settings.jobTypes} selected={reportJob} onChange={setReportJob} />
            </div>
            <div ref={reportRef} className="bg-white p-6 rounded-xl border border-slate-200">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
                    <div>
                        <h4 className="font-bold text-slate-800">{reportType === 'order' ? 'รายการที่ต้องสั่งซื้อ' : 'สรุปยอดคงเหลือ'}</h4>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest">{new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                    </div>
                    <div className="w-10 h-10 bg-blue-600 text-white rounded-lg flex items-center justify-center shadow-md"><i className="fa-solid fa-layer-group"></i></div>
                </div>
                <p className="text-xs text-slate-500 mb-3 font-medium">พบ {reportData.length} รายการ:</p>
                <div className="space-y-2 max-h-80 overflow-y-auto hide-scroll px-1">
                    {reportData.map(item => (
                        <div key={item.itemId} className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0 last:pb-0 animate-fade-in">
                            <div className="overflow-hidden pr-2">
                                <div className="text-sm font-bold text-slate-800 truncate">{item.name}</div>
                                <div className="text-[10px] text-slate-400 uppercase">{item.jobType}</div>
                            </div>
                            <div className={`text-sm font-bold whitespace-nowrap px-3 py-1 rounded-lg ${item.quantity <= item.minThreshold ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-800'}`}>
                                {item.quantity} <span className="text-[10px] font-normal opacity-70">{item.unit}</span>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-100 text-center">
                    <p className="text-[9px] text-slate-400 italic">จัดทำโดยระบบ Lab Smart System</p>
                </div>
            </div>
        </Modal>
    );
};

export default ReportModal;