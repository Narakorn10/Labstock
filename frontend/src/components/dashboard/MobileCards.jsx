import Badge from '../Badge';
import { SkeletonRow } from '../Skeleton';
import { highlightText } from '../../utils/text';

const MobileCards = ({ loading, filteredData, search, setLotModalData }) => {
    return (
        <div className="md:hidden space-y-4 pb-4">
            {loading ? Array(3).fill(0).map((_, i) => <SkeletonRow key={i} />) :
                filteredData.length === 0 ? <div className="text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-100 animate-fade-in">
                <i className="fa-solid fa-folder-open text-4xl mb-4 opacity-20"></i>
                <p>ไม่พบข้อมูลที่ตรงกับตัวกรอง</p>
                </div> :
                filteredData.map(item => {
                const alert = item.quantity <= item.minThreshold;
                return (
                    <div key={item.itemId} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 animate-fade-in">
                        <div className="flex justify-between items-start mb-3">
                            <div className="pr-4 overflow-hidden">
                                <div className="text-[10px] font-bold text-slate-400 mb-0.5">{highlightText(item.itemId, search)}</div>
                                <div className="font-bold text-slate-800 text-base leading-tight truncate">{highlightText(item.name, search)}</div>
                            </div>
                            <div className={`flex flex-col items-end flex-shrink-0 ${alert ? 'text-red-600' : 'text-slate-800'}`}>
                                <span className="font-bold text-2xl leading-none">{item.quantity}</span>
                                <span className="text-[10px] font-medium text-slate-500 mt-1 uppercase">{item.unit}</span>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-4"><Badge color="blue">{item.reagentType}</Badge><Badge color="green">{item.jobType}</Badge></div>
                        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                            <div className="text-[11px] text-slate-500">Min Alert: <span className="font-bold text-slate-700">{item.minThreshold}</span></div>
                            <button onClick={() => setLotModalData(item)} className="text-slate-700 font-bold text-xs bg-slate-100 px-4 py-2 rounded-xl active-scale transition">ดูราย Lot ({item.lots.length})</button>
                        </div>
                    </div>
                )
            })}
        </div>
    );
};

export default MobileCards;