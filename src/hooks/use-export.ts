'use client';

import { useRef } from 'react';
import { toPng } from 'html-to-image';

export const useExport = (reportData: any[], reportType: string, reportJob: string) => {
    const reportRef = useRef<HTMLDivElement>(null);

    const exportCSV = () => {
        if (reportData.length === 0) return alert("ไม่มีข้อมูลให้ดาวน์โหลด");
        let csv = "\uFEFFชื่อน้ำยา,ประเภทงาน,เครื่องมือ,จุดแจ้งเตือน,คงเหลือ,หน่วย\n";
        reportData.forEach(i => csv += `"${(i.name||'').replace(/"/g,'""')}","${i.jobType}","${i.machineType}",${i.minThreshold},${i.quantity},"${i.unit}"\n`);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        link.download = `Report_Reagent_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    };

    const printPDF = () => {
        if (reportData.length === 0) return alert("ไม่มีข้อมูลให้พิมพ์");
        let title = reportType === 'order' ? "สรุปรายการน้ำยาที่ต้องสั่งซื้อเพิ่ม" : "สรุปยอดคงเหลือสต๊อกหลักปัจจุบัน";
        if (reportJob !== 'ALL') title += ` (แผนก: ${reportJob})`;
        
        let html = `<html><head><title>${title}</title><style>body{font-family:Tahoma,sans-serif; padding: 20px;} table{width:100%;border-collapse:collapse;margin-top:10px;} th,td{border:1px solid #ddd;padding:12px;text-align:left;font-size:14px;} th{background:#f3f4f6;} .alert{color:red;font-weight:bold;}</style></head><body><h2>${title}</h2><table><tr><th>ชื่อน้ำยา</th><th>แผนก</th><th style="text-align:right">คงเหลือ</th></tr>`;
        reportData.forEach(i => html += `<tr><td>${i.name}</td><td>${i.jobType}</td><td style="text-align:right" class="${i.quantity<=i.minThreshold?'alert':''}">${i.quantity} ${i.unit}</td></tr>`);
        html += `</table><p style="text-align:right;font-size:12px;margin-top:40px;">พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}</p></body></html>`;
        
        const iframe = document.createElement('iframe'); 
        iframe.style.display = 'none'; 
        document.body.appendChild(iframe);
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
            doc.write(html); 
            doc.close();
            setTimeout(() => { 
                iframe.contentWindow?.print(); 
                document.body.removeChild(iframe); 
            }, 500);
        }
    };

    const formatLineText = () => {
        let title = reportType === 'order' ? "⚠️ ต้องสั่งซื้อเพิ่ม" : "📊 สรุปยอดคงเหลือ";
        if (reportJob !== 'ALL') title += `\n[แผนก: ${reportJob}]`;
        
        let text = `${title}\n` + "=".repeat(20) + "\n";
        reportData.forEach(i => {
            text += `• ${i.name}: ${i.quantity} ${i.unit}\n`;
        });
        return text;
    };

    const nativeShare = async () => {
        if (reportData.length === 0) return alert("ไม่มีรายการให้แชร์");
        const text = formatLineText();
        
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'LabStock Report',
                    text: text,
                });
            } catch (err) {
                console.error('Share failed:', err);
            }
        } else {
            // Fallback to copy to clipboard
            navigator.clipboard.writeText(text).then(() => {
                alert("เบราว์เซอร์ไม่รองรับระบบแชร์โดยตรง ระบบได้คัดลอกข้อความไว้ให้แล้ว คุณสามารถนำไปวางใน LINE ได้ทันที");
            });
        }
    };

    const exportImage = async () => {
        if (!reportRef.current) return;
        try {
            const dataUrl = await toPng(reportRef.current, { cacheBust: true, backgroundColor: '#ffffff' });
            const link = document.createElement('a');
            link.download = `LabStock_Report_${new Date().getTime()}.png`;
            link.href = dataUrl;
            link.click();
        } catch (err) {
            console.error('Image export failed:', err);
        }
    };

    return { reportRef, exportCSV, printPDF, nativeShare, exportImage };
};
