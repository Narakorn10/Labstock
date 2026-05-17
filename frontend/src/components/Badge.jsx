import React from 'react';

const Badge = ({ children, color }) => {
    const colors = {
        blue: "bg-blue-50 text-blue-600", green: "bg-emerald-50 text-emerald-600",
        purple: "bg-purple-50 text-purple-600", red: "bg-red-50 text-red-600",
        gray: "bg-slate-100 text-slate-600"
    };
    return <span className={`px-2 py-1 rounded-md text-[10px] font-medium tracking-wide uppercase ${colors[color] || colors.gray}`}>{children}</span>;
};

export default Badge;
