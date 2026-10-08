import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center p-4">
      <div className="air-card w-full rounded-2xl text-center">
        <h1 className="text-xl font-semibold text-text">ไม่พบหน้าที่ต้องการ</h1>
        <p className="mt-3 text-sm text-text-muted">
          กรุณาตรวจสอบลิงก์ว่าถูกต้องหรือไม่ หรือเลือกหน้าที่ต้องการจากเมนู
        </p>
        <div className="mt-5 flex justify-center">
          <Link href="/" className="air-btn-primary">
            กลับหน้าแรก
          </Link>
        </div>
      </div>
    </div>
  );
}
