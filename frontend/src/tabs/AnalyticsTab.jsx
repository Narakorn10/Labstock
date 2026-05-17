import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import SummaryCards from '../components/dashboard/SummaryCards';

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

            {/* Reusable Summary Cards for Analytics */}
            <SummaryCards stats={stats} activeFilter={null} onFilterClick={onNavigate} />

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