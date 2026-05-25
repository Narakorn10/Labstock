import Modal from './Modal';

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, isDanger }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title} icon="fa-circle-exclamation" titleColor={isDanger ? "text-red-600" : "text-amber-600"}>
            <div className="text-slate-600 mb-6 text-center sm:text-left">{message}</div>
            <div className="flex flex-col sm:flex-row justify-end gap-3">
                <button onClick={onClose} className="w-full sm:w-auto px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium active-scale transition">ยกเลิก</button>
                <button onClick={() => { onConfirm(); onClose(); }} className={`w-full sm:w-auto px-6 py-3 text-white rounded-xl font-medium active-scale transition shadow-md ${isDanger ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}>ยืนยัน</button>
            </div>
        </Modal>
    );
};

export default ConfirmModal;
