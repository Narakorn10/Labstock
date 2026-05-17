import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const AnalyticsTab = ({ activeDashboard, onNavigate }) => {
    const lastUpdated = useMemo(() => {
        const now = new Date();
        return now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    }, [activeDashboard]);

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

        // Top 5 frequently used core reagents (highest weeklyTarget) that are low stock
        const topLowStockCore = activeDashboard
            .filter(i => i.quantity <= i.minThreshold)
            .sort((a, b) => b.weeklyTarget - a.weeklyTarget)
            .slice(0, 5)
            .map(i => ({
                name: i.name.length > 15 ? i.name.substring(0, 15) + '...' : i.name,
                fullName: i.name,
                quantity: i.quantity,
                minThreshold: i.minThreshold
            }));

        const pieData = [
            { name: 'ปกติ', value: healthyItems, color: '#10b981' }, // Emerald-500
            { name: 'ใกล้หมด', value: lowStockItems, color: '#ef4444' } // Red-500
        ];

        return { totalItems, lowStockItems, healthyItems, expiredLotsCount, topLowStockCore, pieData };
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

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <button onClick={() => onNavigate('all')} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm text-left active-scale transition group">
                    <div className="flex justify-between items-start mb-2">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">น้ำยาทั้งหมด</div>
                        <i className="fa-solid fa-layer-group text-slate-200 group-hover:text-blue-500 transition-colors"></i>
                    </div>
                    <div className="text-3xl font-bold text-slate-800">{stats.totalItems}</div>
                    <div className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">คลิกเพื่อดูทั้งหมด <i className="fa-solid fa-chevron-right text-[8px]"></i></div>
                </button>
                <button onClick={() => onNavigate('healthy')} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm text-left active-scale transition group border-l-4 border-l-emerald-500">
                    <div className="flex justify-between items-start mb-2">
                        <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">สต๊อกปกติ</div>
                        <i className="fa-solid fa-circle-check text-emerald-100 group-hover:text-emerald-500 transition-colors"></i>
                    </div>
                    <div className="text-3xl font-bold text-emerald-700">{stats.healthyItems}</div>
                    <div className="text-[10px] text-emerald-600 mt-2 flex items-center gap-1">สูงกว่าจุดเตือน <i className="fa-solid fa-chevron-right text-[8px]"></i></div>
                </button>
                <button onClick={() => onNavigate('low')} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm text-left active-scale transition group border-l-4 border-l-red-500">
                    <div className="flex justify-between items-start mb-2">
                        <div className="text-[10px] font-bold text-red-600 uppercase tracking-wider">ต้องสั่งเพิ่ม</div>
                        <i className="fa-solid fa-triangle-exclamation text-red-100 group-hover:text-red-500 transition-colors"></i>
                    </div>
                    <div className="text-3xl font-bold text-red-700">{stats.lowStockItems}</div>
                    <div className="text-[10px] text-red-600 mt-2 flex items-center gap-1">ต่ำกว่าจุดเตือน <i className="fa-solid fa-chevron-right text-[8px]"></i></div>
                </button>
                <button onClick={() => onNavigate('expired')} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm text-left active-scale transition group border-l-4 border-l-amber-500">
                    <div className="flex justify-between items-start mb-2">
                        <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Lot หมดอายุ</div>
                        <i className="fa-solid fa-hourglass-end text-amber-100 group-hover:text-amber-500 transition-colors"></i>
                    </div>
                    <div className="text-3xl font-bold text-amber-700">{stats.expiredLotsCount}</div>
                    <div className="text-[10px] text-amber-600 mt-2 flex items-center gap-1">รายการที่มีของเสีย <i className="fa-solid fa-chevron-right text-[8px]"></i></div>
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Pie Chart */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                        <i className="fa-solid fa-chart-pie text-blue-500"></i> สัดส่วนสต๊อก
                    </h3>
                    <div className="h-64">
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

                {/* Bar Chart */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                        <i className="fa-solid fa-chart-bar text-red-500"></i> ตัวหลักที่ใช้บ่อย (สต๊อกต่ำ)
                    </h3>
                    <div className="h-64">
                        {stats.topLowStockCore.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={stats.topLowStockCore}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                    <XAxis type="number" hide />
                                    <YAxis 
                                        dataKey="name" 
                                        type="category" 
                                        width={100} 
                                        tick={{fontSize: 10, fontWeight: 'bold'}}
                                    />
                                    <Tooltip 
                                        formatter={(value, name, props) => [value, name === 'quantity' ? 'คงเหลือ' : 'จุดเตือน']}
                                        labelFormatter={(label) => {
                                            const item = stats.topLowStockCore.find(i => i.name === label);
                                            return item ? item.fullName : label;
                                        }}
                                    />
                                    <Legend />
                                    <Bar dataKey="quantity" name="ยอดคงเหลือ" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                                    <Bar dataKey="minThreshold" name="จุดเตือน" fill="#cbd5e1" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                                ไม่มีรายการที่สต๊อกต่ำกว่าเกณฑ์
                            </div>
                        )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-4">* แสดงรายการที่ใช้บ่อย (Weekly Target สูง) ที่ต้องการการเติมด่วน</p>
                </div>
            </div>
        </div>
    );
};

export default AnalyticsTab;