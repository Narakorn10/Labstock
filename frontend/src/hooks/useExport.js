import { useRef } from 'react';
import { toPng } from 'html-to-image';

const useExport = (reportData, reportType, reportJob, showToast) => {
    const reportRef = useRef(null);

    const exportCSV = () => {
        if (reportData.length === 0) return showToast("ไม่มีข้อมูลให้ดาวน์โหลด", "error");
        let csv = "\uFEFFชื่อน้ำยา,ประเภทงาน,เครื่องมือ,จุดแจ้งเตือน,คงเหลือ,หน่วย\n";
        reportData.forEach(i => csv += `"${(i.name||'').replace(/"/g,'""')}","${i.jobType}","${i.machineType}",${i.minThreshold},${i.quantity},"${i.unit}"\n`);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        link.download = `Report_Reagent_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    };

    const printPDF = () => {
        if (reportData.length === 0) return showToast("ไม่มีข้อมูลให้พิมพ์", "error");
        let title = reportType === 'order' ? "สรุปรายการน้ำยาที่ต้องสั่งซื้อเพิ่ม" : "สรุปยอดคงเหลือสต๊อกหลักปัจจุบัน";
        if (!reportJob.includes('ALL')) title += ` (แผนก: ${reportJob.join(', ')})`;
        let html = `<html><head><title>${title}</title><style>body{font-family:Tahoma,sans-serif;} table{width:100%;border-collapse:collapse;margin-top:10px;} th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:14px;} th{background:#f3f4f6;} .alert{color:red;font-weight:bold;}</style></head><body><h2>${title}</h2><table><tr><th>ชื่อน้ำยา</th><th>แผนก</th><th style="text-align:right">คงเหลือ</th></tr>`;
        reportData.forEach(i => html += `<tr><td>${i.name}</td><td>${i.jobType}</td><td style="text-align:right" class="${i.quantity<=i.minThreshold?'alert':''}">${i.quantity} ${i.unit}</td></tr>`);
        html += `</table><p style="text-align:right;font-size:12px;margin-top:20px;">พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}</p></body></html>`;
        const iframe = document.createElement('iframe'); iframe.style.display = 'none'; document.body.appendChild(iframe);
        iframe.contentDocument.write(html); iframe.contentDocument.close();
        setTimeout(() => { iframe.contentWindow.print(); document.body.removeChild(iframe); }, 250);
    };

    const copyLine = () => {
        if (reportData.length === 0) return showToast("ไม่มีรายการให้คัดลอก", "error");
        let title = reportType === 'order' ? "⚠️ ต้องสั่งซื้อเพิ่ม" : "📊 สรุปยอดคงเหลือ";
        if (!reportJob.includes('ALL')) title += `\n[แผนก: ${reportJob.join(', ')}]`;
        let text = `${title}\n` + "=".repeat(20) + "\n";
        reportData.forEach(i => text += `• ${i.name}\n  คงเหลือ: ${i.quantity} ${i.unit} (เตือน: ${i.minThreshold})\n`);
        const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
        showToast("คัดลอกข้อความแล้ว นำไปวางใน Line ได้เลย");
    };

    const exportImage = async () => {
        if (!reportRef.current || reportData.length === 0) return;
        showToast("กำลังสร้างรูปภาพ...");
        try {
            const dataUrl = await toPng(reportRef.current, { backgroundColor: '#f8fafc', cacheBust: true, style: { borderRadius: '0' } });
            const link = document.createElement('a');
            link.download = `Report_${new Date().getTime()}.png`;
            link.href = dataUrl;
            link.click();
            showToast("บันทึกรูปภาพสำเร็จ");
        } catch (err) {
            console.error(err);
            showToast("ไม่สามารถสร้างรูปภาพได้", "error");
        }
    };

    return { reportRef, exportCSV, printPDF, copyLine, exportImage };
};

export default useExport;