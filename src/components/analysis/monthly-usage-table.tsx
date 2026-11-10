'use client';

import type { MonthlyMatrix } from '@/lib/analysis-summary';

function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits }).format(value);
}

const monthLabel = (month: string) => new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit' }).format(new Date(`${month}-01T00:00:00`));

const thClass = 'whitespace-nowrap bg-ground px-3.5 py-2.5 text-right text-[13px] font-medium text-gray-600';
const tdClass = 'whitespace-nowrap border-b border-line px-3.5 py-3 text-right text-sm tabular-nums';

/**
 * Usage per reagent per month (dispensed + refill). The name column stays on the left while the table scrolls sideways
 * inside its own box. Months that are only partly inside the chosen days are marked. Clicking a row opens that reagent's tab.
 */
export function MonthlyUsageTable({
  matrix,
  nameOf,
  onSelectItem
}: {
  matrix: MonthlyMatrix;
  nameOf: (itemId: string) => string;
  onSelectItem: (itemId: string) => void;
}) {
  return (
    <div className="max-w-full overflow-x-auto rounded-[10px] border border-line">
      <table className="w-full border-separate border-spacing-0 text-left">
        <caption className="sr-only">ยอดใช้รายน้ำยา แยกรายเดือน</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-[12rem] whitespace-nowrap bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">น้ำยา</th>
            {matrix.months.map((column) => (
              <th key={column.month} scope="col" className={thClass}>
                {monthLabel(column.month)}
                {column.partial && (
                  <span className="block text-[11px] font-normal text-warn">* {column.daysInRange}/{column.daysInMonth} วัน</span>
                )}
              </th>
            ))}
            <th scope="col" className={`${thClass} font-semibold text-ink`}>รวม</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.itemId} onClick={() => onSelectItem(row.itemId)} className="group cursor-pointer">
              <td className="sticky left-0 z-10 min-w-[12rem] border-b border-line bg-white px-3.5 py-3 text-sm group-hover:bg-[#fafafa]">
                <button type="button" onClick={(event) => { event.stopPropagation(); onSelectItem(row.itemId); }} className="text-left">
                  <span className="block font-medium">{nameOf(row.itemId)}</span>
                  <span className="block text-xs text-gray-600">{row.itemId}</span>
                </button>
              </td>
              {matrix.months.map((column) => {
                const cell = row.months[column.month];
                return (
                  <td key={column.month} className={`${tdClass} group-hover:bg-[#fafafa]`} title={cell ? `เบิกไปหน้างาน ${formatNumber(cell.regular)} + เบิกเติม ${formatNumber(cell.refill)}` : undefined}>
                    {cell ? formatNumber(cell.total) : '-'}
                  </td>
                );
              })}
              <td className={`${tdClass} font-semibold group-hover:bg-[#fafafa]`}>{formatNumber(row.total.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {matrix.rows.length === 0 && <p className="px-4 py-10 text-sm text-gray-600">ไม่พบข้อมูลในช่วงวันที่เลือก</p>}
    </div>
  );
}
