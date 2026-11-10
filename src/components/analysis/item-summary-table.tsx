'use client';

import type { ItemSummaryRow } from '@/lib/analysis-summary';

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits }).format(value);
}

const thClass = 'whitespace-nowrap bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600';
const tdClass = 'border-b border-line px-3.5 py-3 text-sm tabular-nums';

/** Usage summary per reagent for the selected days. Clicking a row opens that reagent's own tab. */
export function ItemSummaryTable({ rows, onSelectItem }: { rows: ItemSummaryRow[]; onSelectItem: (itemId: string) => void }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-left">
        <caption className="sr-only">สรุปยอดใช้รายน้ำยาในช่วงวันที่เลือก</caption>
        <thead>
          <tr>
            <th scope="col" className={`${thClass} rounded-l-[10px]`}>น้ำยา</th>
            <th scope="col" className={`${thClass} text-right`}>ยอดใช้รวม</th>
            <th scope="col" className={`${thClass} text-right`}>เบิกไปหน้างาน</th>
            <th scope="col" className={`${thClass} text-right`}>เบิกเติม</th>
            <th scope="col" className={`${thClass} text-right`}>เฉลี่ย/วัน</th>
            <th scope="col" className={`${thClass} text-right`}>เฉลี่ย/สัปดาห์</th>
            <th scope="col" className={`${thClass} text-right`}>คงเหลือ</th>
            <th scope="col" className={`${thClass} text-right`}>Min</th>
            <th scope="col" className={`${thClass} rounded-r-[10px] text-right`}>วันจนถึง Min (ตามแผนจัดซื้อ)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itemId} onClick={() => onSelectItem(row.itemId)} className="cursor-pointer transition-colors hover:bg-[#fafafa]">
              <td className="border-b border-line px-3.5 py-3 text-sm">
                <button type="button" onClick={(event) => { event.stopPropagation(); onSelectItem(row.itemId); }} className="text-left">
                  <span className="block font-medium">{row.name}</span>
                  <span className="block text-xs text-gray-600">{row.itemId}</span>
                </button>
              </td>
              <td className={`${tdClass} text-right font-semibold`}>{formatNumber(row.usage, 2)}</td>
              <td className={`${tdClass} text-right`}>{formatNumber(row.dispensed, 2)}</td>
              <td className={`${tdClass} text-right`}>{formatNumber(row.refill, 2)}</td>
              <td className={`${tdClass} text-right`}>{formatNumber(row.averagePerDay, 2)}</td>
              <td className={`${tdClass} text-right`}>{formatNumber(row.averagePerWeek, 2)}</td>
              <td className={`${tdClass} text-right`}>{row.quantity === null ? '-' : `${formatNumber(row.quantity)} ${row.unit}`}</td>
              <td className={`${tdClass} text-right`}>{row.minThreshold === null ? '-' : formatNumber(row.minThreshold)}</td>
              <td className={`${tdClass} text-right`}>{row.daysUntilMin === null ? 'ข้อมูลไม่พอ' : `${formatNumber(row.daysUntilMin)} วัน`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-10 text-sm text-gray-600">ไม่พบข้อมูลในช่วงวันที่เลือก</p>}
    </div>
  );
}
