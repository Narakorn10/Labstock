import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import SummaryCards from '../components/dashboard/SummaryCards';

const AnalyticsTab = ({ activeDashboard, onNavigate }) => {
    const lastUpdated = useMemo(() => {
        const now = new Date();
        return now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    }, []);

    const stats = useMemo(() => {
        const totalItems = activeDashboard.length;
        const lowStockItems = activeDashboard.filter(i => i.quantity <= i.minThreshold).length;
        const healthyItems = totalItems - lowStockItems;
        
        let expiredLotsCount = 0;
        const now = new Date();
        activeDashboard.forEach(item => {
            item.lots.forEach(lot => {
                if (new Date(lot.expDate) < now) {
                    expiredLotsCount++;
                }
            });
        });

        // 🚨 จัดกลุ่มรายการที่ต้องสั่งซื้อ (Low Stock) ตามประเภทงาน
        // เฉพาะรายการที่มีการตั้งจุดเตือน (minThreshold > 0)
        const lowStockGrouped = activeDashboard
            .filter(i => i.minThreshold > 0 && i.quantity <= i.minThreshold)
            .reduce((acc, item) => {
                const job = item.jobType || 'อื่นๆ';
                if (!acc[job]) acc[job] = [];
                acc[job].push(item);
                return acc;
            }, {});

        const pieData = [
            { name: 'ปกติ', value: healthyItems, color: '#10b981' }, 
            { name: 'ใกล้หมด', value: lowStockItems, color: '#ef4444' } 
        ];

        return { totalItems, lowStockItems, healthyItems, expiredLotsCount, lowStockGrouped, pieData };
    }, [activeDashboard]);

    return (
        <div className="space-y-6 animate-slide-up pb-24">
            <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">รายงานสถิติวิเคราะห์</h2>
                    <p className="text-xs text-slate-500 mt-1">ภาพรวมปริมาณน้ำยาและรายการที่ต้องสั่งซื้อด่วน</p>
                </div>
                <div className="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <i className="fa-solid fa-clock-rotate-left mr-1.5 text-blue-400"></i>
                    อัปเดตล่าสุด {lastUpdated} น.
                </div>
            </div>

            <SummaryCards stats={stats} activeFilter={null} onFilterClick={onNavigate} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 📊 กราฟวงกลม: สัดส่วนสต๊อก */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col">
                    <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                        <i className="fa-solid fa-chart-pie text-blue-500"></i> สัดส่วนสต๊อกทั้งหมด
                    </h3>
                    <div className="h-64 flex-grow">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={stats.pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {stats.pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36}/>
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 🚨 กระดานแจ้งเตือน: รายการที่ต้องเติมด่วน (Visual List) */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col max-h-[500px]">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-2"><i className="fa-solid fa-triangle-exclamation text-amber-500"></i> รายการที่ต้องสั่งซื้อเพิ่ม</div>
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-full uppercase tracking-tighter">ยอดจากสต๊อกหลัก</span>
                    </h3>
                    
                    <div className="flex-grow overflow-y-auto pr-1 hide-scroll space-y-6">
                        {Object.keys(stats.lowStockGrouped).length > 0 ? (
                            Object.keys(stats.lowStockGrouped).map(job => (
                                <div key={job} className="animate-fade-in">
                                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span> {job}
                                    </div>
                                    <div className="space-y-4">
                                        {stats.lowStockGrouped[job].map(item => {
                                            const percent = Math.min(100, (item.quantity / (item.minThreshold || 1)) * 100);
                                            const barColor = item.quantity === 0 ? 'bg-red-500' : 'bg-amber-500';
                                            
                                            return (
                                                <div key={item.itemId} className="group">
                                                    <div className="flex justify-between items-end mb-1.5">
                                                        <div className="text-sm font-bold text-slate-700 truncate pr-4 group-hover:text-blue-600 transition-colors">{item.name}</div>
                                                        <div className="text-[10px] font-mono font-bold text-slate-500 whitespace-nowrap">
                                                            <span className="text-blue-600">{item.quantity}</span> <span className="font-normal opacity-60">/ {item.minThreshold} {item.unit}</span>
                                                        </div>
                                                    </div>
                                                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                                                        <div 
                                                            className={`h-full ${barColor} transition-all duration-1000 ease-out`} 
                                                            style={{ width: `${percent}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                                <i className="fa-regular fa-face-smile text-4xl mb-3 opacity-20"></i>
                                <p className="text-sm font-medium">สต๊อกน้ำยาทั้งหมดอยู่ในเกณฑ์ปกติ</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            <div className="text-center">
                <p className="text-[10px] text-slate-400 italic">* รายการแจ้งเตือนพิจารณาจากน้ำยาในสต๊อกหลักที่ยอดต่ำกว่าจุดเตือน (Min Alert) ที่ตั้งไว้</p>
            </div>
        </div>
    );
};

export default AnalyticsTab;