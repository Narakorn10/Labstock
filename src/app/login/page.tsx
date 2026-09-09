'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { AlertCircle, ArrowLeft, Eye, EyeOff, FlaskConical, KeyRound, Loader2, LockKeyhole, UserRound } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      await login({ username, password });
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    setError('');
    setGoogleLoading(true);
    signIn('google', { callbackUrl: '/dashboard' });
  };

  const isBusy = loading || googleLoading;

  return (
    <main className="min-h-screen bg-[#f4fafb] p-3 text-[#102a2e] sm:p-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-[1440px] overflow-hidden rounded-[2rem] border border-[#c9e1e3] bg-white shadow-[0_28px_80px_-42px_rgba(16,42,67,0.55)] sm:min-h-[calc(100vh-3rem)] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden min-h-[760px] overflow-hidden bg-[#102a43] lg:block">
          <Image src="/images/labstock-clinical-inventory-hero.png" alt="ชั้นวางน้ำยาและอุปกรณ์สำหรับเครื่องตรวจวิเคราะห์อัตโนมัติ" fill sizes="(max-width: 1024px) 0vw, 55vw" className="object-cover object-center opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-br from-[#071b2d]/95 via-[#071b2d]/60 to-[#0b8f8c]/35" />
          <div className="relative flex min-h-[760px] flex-col justify-between p-10 xl:p-14">
            <Link href="/" className="flex w-fit items-center gap-3 text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6ee7e0]"><span className="flex size-11 items-center justify-center rounded-2xl bg-[#35c7c1] text-[#102a43]"><FlaskConical size={24} /></span><span><span className="block text-xl font-black tracking-[-0.04em]">LabStock</span><span className="block text-[9px] font-bold tracking-[0.18em] text-[#b9dddf]">LABORATORY INVENTORY</span></span></Link>
            <div className="max-w-xl text-white"><p className="mb-5 text-[11px] font-black tracking-[0.18em] text-[#6ee7e0]">SECURE LAB OPERATIONS</p><h1 className="text-5xl font-black leading-[1.08] tracking-[-0.06em] xl:text-6xl">คลังน้ำยาที่ทีมแล็บ<br /><span className="text-[#6ee7e0]">ไว้ใจได้</span></h1><p className="mt-6 max-w-lg text-base leading-8 text-[#c3dfe1]">ติดตามน้ำยาสำหรับเครื่องตรวจวิเคราะห์อัตโนมัติอย่างเป็นระบบ ตั้งแต่ lot และวันหมดอายุ ไปจนถึงประวัติการเบิกใช้</p><div className="mt-9 flex flex-wrap gap-3">{['Analyzer reagent', 'Lot traceability', 'Expiry alerts'].map((item) => <span key={item} className="rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold text-[#e4f6f5] backdrop-blur-sm">{item}</span>)}</div></div>
            <div className="flex items-center gap-3 text-sm font-semibold text-[#b9dddf]"><LockKeyhole size={17} className="text-[#6ee7e0]" />ข้อมูลการเข้าใช้ถูกตรวจสอบตามบัญชีผู้ใช้งาน</div>
          </div>
        </section>

        <section className="flex min-h-[calc(100vh-1.5rem)] flex-col bg-white px-5 py-7 sm:px-10 sm:py-10 lg:min-h-[760px] lg:px-14 lg:py-12 xl:px-20">
          <div className="flex items-center justify-between"><Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[#5d7378] transition hover:text-[#0b8f8c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0b8f8c]"><ArrowLeft size={16} />กลับหน้าแรก</Link><span className="text-[10px] font-black tracking-[0.16em] text-[#8aa1a5] lg:hidden">LABSTOCK</span></div>
          <div className="m-auto w-full max-w-md py-12">
            <div className="mb-9 lg:hidden"><span className="flex size-12 items-center justify-center rounded-2xl bg-[#0b8f8c] text-white shadow-lg shadow-[#0b8f8c]/20"><FlaskConical size={25} /></span><p className="mt-4 text-2xl font-black tracking-[-0.05em] text-[#102a43]">เข้าสู่ LabStock</p></div>
            <p className="text-[11px] font-black tracking-[0.18em] text-[#0b8f8c]">WELCOME BACK</p><h2 className="mt-3 text-4xl font-black tracking-[-0.055em] text-[#102a43]">เข้าสู่ระบบ</h2><p className="mt-3 text-sm leading-6 text-[#6e8589]">ใช้บัญชีของคุณเพื่อดูสถานะน้ำยาและงานที่ต้องดำเนินการ</p>
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-[#f1c5c1] bg-[#fff4f2] p-4 text-sm font-semibold leading-6 text-[#a33b35]"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}
              <div className="space-y-2"><label htmlFor="login-identifier" className="text-sm font-bold text-[#28464b]">อีเมลหรือชื่อผู้ใช้</label><div className="relative"><UserRound className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8aa1a5]" size={18} /><input id="login-identifier" name="username" type="text" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="เช่น medtech01" className="min-h-14 w-full rounded-2xl border border-[#c9e1e3] bg-[#f8fcfc] pl-12 pr-4 text-sm font-semibold text-[#102a43] outline-none transition placeholder:text-[#9aaeb1] focus:border-[#0b8f8c] focus:bg-white focus:ring-4 focus:ring-[#0b8f8c]/10" /></div></div>
              <div className="space-y-2"><label htmlFor="login-password" className="text-sm font-bold text-[#28464b]">รหัสผ่าน</label><div className="relative"><KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8aa1a5]" size={18} /><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="กรอกรหัสผ่าน" className="min-h-14 w-full rounded-2xl border border-[#c9e1e3] bg-[#f8fcfc] pl-12 pr-12 text-sm font-semibold text-[#102a43] outline-none transition placeholder:text-[#9aaeb1] focus:border-[#0b8f8c] focus:bg-white focus:ring-4 focus:ring-[#0b8f8c]/10" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-xl text-[#6e8589] transition hover:bg-[#e3f1f2] hover:text-[#0b8f8c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b8f8c]">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
              <div className="flex items-center justify-between gap-4 text-xs font-semibold"><label className="flex items-center gap-2 text-[#6e8589]"><input type="checkbox" className="size-4 rounded border-[#96c7cb] accent-[#0b8f8c]" />จดจำฉันในระบบ</label><Link href="/reset-password" className="font-bold text-[#0b8f8c] hover:text-[#075e5b]">ลืมรหัสผ่าน?</Link></div>
              <button type="submit" disabled={isBusy} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#0b8f8c] text-sm font-black text-white shadow-xl shadow-[#0b8f8c]/20 transition hover:bg-[#087772] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102a43]">{loading ? <Loader2 className="animate-spin" size={20} /> : 'เข้าสู่ระบบ'}</button>
              <div className="flex items-center gap-3"><div className="h-px flex-1 bg-[#e3f1f2]" /><span className="text-[10px] font-black tracking-[0.14em] text-[#9aafb2]">หรือ</span><div className="h-px flex-1 bg-[#e3f1f2]" /></div>
              <button type="button" onClick={handleGoogleLogin} disabled={isBusy} className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border border-[#c9e1e3] bg-white text-sm font-black text-[#28464b] transition hover:bg-[#f4fafb] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b8f8c]">{googleLoading ? <Loader2 className="animate-spin" size={20} /> : <span className="text-lg font-black text-[#4285f4]">G</span>}เข้าสู่ระบบด้วย Google</button>
              <p className="pt-2 text-center text-sm font-semibold text-[#6e8589]">ยังไม่มีบัญชี? <Link href="/register" className="font-black text-[#0b8f8c] underline decoration-[#9bd8d5] underline-offset-4 hover:text-[#075e5b]">ลงทะเบียนด้วยอีเมล</Link></p>
            </form>
          </div>
          <p className="text-center text-[10px] font-semibold tracking-wide text-[#9aafb2]">LabStock · ระบบบริหารคลังน้ำยาเครื่องตรวจ</p>
        </section>
      </div>
    </main>
  );
}
