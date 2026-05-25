const SummaryCards = ({ stats, activeFilter, onFilterClick }) => {
    const cards = [
        { id: 'all', label: 'น้ำยาทั้งหมด', value: stats.totalItems, sub: 'รายการทั้งหมด', icon: 'fa-layer-group', color: 'slate' },
        { id: 'healthy', label: 'สต๊อกปกติ', value: stats.healthyItems, sub: 'สูงกว่าจุดเตือน', icon: 'fa-circle-check', color: 'emerald' },
        { id: 'low', label: 'ต้องสั่งเพิ่ม', value: stats.lowStockItems, sub: 'ต่ำกว่าจุดเตือน', icon: 'fa-triangle-exclamation', color: 'red' },
        { id: 'expired', label: 'Lot หมดอายุ', value: stats.expiredLotsCount, sub: 'รายการที่มีของเสีย', icon: 'fa-hourglass-end', color: 'amber' }
    ];

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {cards.map(card => {
                const isActive = activeFilter === card.id;
                const colorClass = {
                    slate: isActive ? 'bg-slate-900 text-white border-slate-900 shadow-slate-200' : 'bg-white text-slate-800 border-slate-100 hover:border-slate-300',
                    emerald: isActive ? 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-200' : 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:border-emerald-300',
                    red: isActive ? 'bg-red-600 text-white border-red-600 shadow-red-200' : 'bg-red-50 text-red-700 border-red-100 hover:border-red-300',
                    amber: isActive ? 'bg-amber-500 text-white border-amber-500 shadow-amber-200' : 'bg-amber-50 text-amber-700 border-amber-100 hover:border-amber-300'
                }[card.color];

                const iconColor = isActive ? 'text-white/50' : {
                    slate: 'text-slate-200',
                    emerald: 'text-emerald-200',
                    red: 'text-red-200',
                    amber: 'text-amber-200'
                }[card.color];

                return (
                    <button 
                        key={card.id}
                        onClick={() => onFilterClick(card.id)}
                        className={`p-4 rounded-2xl border shadow-sm text-left active-scale transition-all duration-200 group relative overflow-hidden ${colorClass}`}
                    >
                        <div className="flex justify-between items-start mb-1 relative z-10">
                            <div className={`text-[9px] font-bold uppercase tracking-wider ${isActive ? 'text-white/80' : ''}`}>{card.label}</div>
                            <i className={`fa-solid ${card.icon} ${iconColor} group-hover:scale-110 transition-transform`}></i>
                        </div>
                        <div className="text-2xl font-bold relative z-10">{card.value}</div>
                        <div className={`text-[9px] mt-1 relative z-10 ${isActive ? 'text-white/70' : 'text-slate-400'}`}>{card.sub}</div>
                        {isActive && <div className="absolute bottom-0 left-0 w-full h-1 bg-white/20 animate-fade-in"></div>}
                    </button>
                );
            })}
        </div>
    );
};

export default SummaryCards;