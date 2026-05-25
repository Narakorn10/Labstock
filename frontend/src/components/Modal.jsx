
const Modal = ({ isOpen, onClose, title, children, width = "max-w-md", icon = null, headerColor = "bg-white", titleColor = "text-slate-800", actions = null }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-0 md:p-4 animate-fade-in">
            <div className={`bg-white w-full ${width} rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] md:max-h-[85vh] animate-slide-up`}>
                <div className="w-full flex justify-center pt-3 pb-1 md:hidden"><div className="w-12 h-1.5 bg-slate-200 rounded-full"></div></div>
                <div className={`px-6 py-4 border-b border-slate-100 flex justify-between items-center ${headerColor}`}>
                    <h3 className={`font-bold text-lg ${titleColor}`}>{icon && <i className={`fa-solid ${icon} mr-2`}></i>}{title}</h3>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-500 rounded-full hover:bg-slate-200 transition"><i className="fa-solid fa-xmark"></i></button>
                </div>
                <div className="p-6 overflow-y-auto flex-grow hide-scroll">{children}</div>
                {actions && <div className="px-6 py-4 border-t border-slate-100 bg-white flex flex-col sm:flex-row justify-end gap-3 rounded-b-2xl">{actions}</div>}
            </div>
        </div>
    );
};

export default Modal;
