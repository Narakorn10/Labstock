import React from 'react';
import Badge from '../Badge';
import { highlightText } from '../../utils/text';

const DesktopTable = ({ loading, filteredData, search, setLotModalData }) => {
    return (
        <div className="hidden md:block bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden max-h-[70vh] overflow-y-auto hide-scroll">
            <table className="w-full text-left text-sm whitespace-nowrap relative">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 font-semibold text-slate-600 z-10 shadow-sm">
                    <tr><th className="px-6 py-4">Item ID</th><th className="px-6 py-4">ชื่อน้ำยา</th><th className="px-6 py-4">หมวดหมู่</th><th className="px-6 py-4 text-right">จุดเตือน</th><th className="px-6 py-4 text-right">คงเหลือ</th><th className="px-6 py-4 text-center">จัดการ</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-slate-700">
                    {loading ? Array(5).fill(0).map((_, i) => (
                        <tr key={i}><td colSpan="6" className="p-0"><div className="animate-pulse bg-white border-b border-slate-50 h-16 w-full flex items-center px-6 gap-4"><div className="h-10 w-10 bg-slate-100 rounded-lg"></div><div className="h-4 w-32 bg-slate-100 rounded"></div><div className="h-4 w-24 bg-slate-100 rounded ml-auto"></div></div></td></tr>
                    )) :
                        filteredData.length === 0 ? <tr><td colSpan="6" className="text-center py-20 text-slate-400">
                        <i className="fa-solid fa-folder-open text-4xl mb-4 opacity-20"></i>
                        <p>ไม่พบข้อมูลที่ตรงกับตัวกรอง</p>
                        </td></tr> :
                        filteredData.map(item => {
                            const alert = item.quantity <= item.minThreshold;
                            return (
                            <tr key={item.itemId} className="hover:bg-slate-50/50 transition animate-fade-in">
                                <td className="px-6 py-4"><div className="font-bold text-slate-800">{highlightText(item.itemId, search)}</div><div className="text-[10px] text-slate-400 font-mono mt-1"><i className="fa-solid fa-barcode mr-1"></i>{highlightText(item.qrCode, search)}</div></td>
                                <td className="px-6 py-4 font-medium text-slate-800">{highlightText(item.name, search)}</td>
                                <td className="px-6 py-4"><div className="flex flex-col gap-1 items-start"><Badge color="blue">{item.reagentType}</Badge><Badge color="green">{item.jobType}</Badge><Badge color="purple">{item.machineType}</Badge></div></td>
                                <td className="px-6 py-4 text-right text-slate-400">{item.minThreshold}</td>
                                <td className={`px-6 py-4 text-right text-lg ${alert ? 'text-red-500 font-bold' : 'font-bold'}`}>{item.quantity} <span className="text-xs font-medium text-slate-500">{item.unit}</span></td>
                                <td className="px-6 py-4 text-center"><button onClick={() => setLotModalData(item)} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-bold active-scale transition">ราย Lot ({item.lots.length})</button></td>
                            </tr>
                            )
                        })}
                </tbody>
            </table>
        </div>
    );
};

export default DesktopTable;