
export const Skeleton = ({ className, width, height, rounded = "rounded-lg" }) => {
    return (
        <div 
            className={`animate-pulse bg-slate-200 ${rounded} ${className}`} 
            style={{ width, height }}
        ></div>
    );
};

export const SkeletonRow = () => (
    <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-100">
        <Skeleton width="40px" height="40px" rounded="rounded-full" />
        <div className="flex-1 space-y-2">
            <Skeleton width="60%" height="14px" />
            <Skeleton width="40%" height="10px" />
        </div>
        <Skeleton width="30px" height="20px" />
    </div>
);

export default Skeleton;