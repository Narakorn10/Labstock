'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { AlertCircle, ArrowLeft, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, UserRound } from 'lucide-react';
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
    <main className="min-h-screen bg-ground pb-6 text-gray-900 lg:bg-gray-50 lg:p-8 lg:pb-8">
      <div className="mx-auto grid max-w-[480px] gap-0 px-[18px] pt-3 lg:min-h-[calc(100vh-4rem)] lg:max-w-[1440px] lg:grid-cols-[1.08fr_0.92fr] lg:overflow-hidden lg:rounded-[2rem] lg:border lg:border-gray-300 lg:bg-white lg:p-0 lg:shadow-[0_28px_80px_-42px_rgba(16,42,67,0.55)]">
        <section aria-label="LabStock · SPR LAB" className="relative flex min-h-[170px] flex-col items-center justify-center gap-2.5 overflow-hidden rounded-[20px] bg-gray-950 px-[22px] py-5 text-center text-white lg:hidden">
          <Image src="/images/labstock-clinical-inventory-hero.png" alt="" fill sizes="480px" priority className="object-cover object-right" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,22,34,0.7),rgba(10,22,34,0.94))]" />
          <div className="relative flex flex-col items-center gap-2.5"><Image src="/images/logo-spr-lab.png" alt="โลโก้ SPR LAB" width={72} height={72} priority className="size-[72px] rounded-2xl ring-1 ring-white/25" /><h1 className="text-xl font-semibold tracking-[-0.01em]">LabStock · SPR LAB</h1><p className="mt-1 text-xs text-[#c9d2db]">กลุ่มงานเทคนิคการแพทย์และพยาธิวิทยาคลินิก</p></div>
        </section>
        <section className="relative hidden min-h-[760px] overflow-hidden bg-gray-950 lg:block">
          <Image src="/images/labstock-clinical-inventory-hero.png" alt="ชั้นวางน้ำยาและอุปกรณ์สำหรับเครื่องตรวจวิเคราะห์อัตโนมัติ" fill sizes="(max-width: 1024px) 0vw, 55vw" className="object-cover object-center opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-br from-gray-950/95 via-gray-950/60 to-gray-900/35" />
          <div className="relative flex min-h-[760px] flex-col justify-between p-10 xl:p-14">
            <Link href="/" className="flex w-fit items-center gap-3 text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300"><Image src="/images/logo-spr-lab.png" alt="" width={44} height={44} className="size-11 rounded-2xl" /><span><span className="block text-xl font-black tracking-[-0.04em]">LabStock</span><span className="block text-[9px] font-bold tracking-[0.18em] text-gray-300">LABORATORY INVENTORY</span></span></Link>
            <div className="max-w-xl text-white"><p className="mb-5 text-[11px] font-black tracking-[0.18em] text-blue-300">SECURE LAB OPERATIONS</p><h1 className="text-5xl font-black leading-[1.08] tracking-[-0.06em] xl:text-6xl">คลังน้ำยาที่ทีมแล็บ<br /><span className="text-blue-300">ไว้ใจได้</span></h1><p className="mt-6 max-w-lg text-base leading-8 text-gray-300">ติดตามน้ำยาสำหรับเครื่องตรวจวิเคราะห์อัตโนมัติอย่างเป็นระบบ ตั้งแต่ lot และวันหมดอายุ ไปจนถึงประวัติการเบิกใช้</p><div className="mt-9 flex flex-wrap gap-3">{['Analyzer reagent', 'Lot traceability', 'Expiry alerts'].map((item) => <span key={item} className="rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold text-gray-200 backdrop-blur-sm">{item}</span>)}</div></div>
            <div className="flex items-center gap-3 text-sm font-semibold text-gray-300"><LockKeyhole size={17} className="text-blue-300" />ข้อมูลการเข้าใช้ถูกตรวจสอบตามบัญชีผู้ใช้งาน</div>
          </div>
        </section>

        <section className="relative -mt-2.5 flex flex-col rounded-[20px] border border-line bg-white px-5 py-[22px] lg:mt-0 lg:min-h-[760px] lg:rounded-none lg:border-0 lg:px-14 lg:py-12 xl:px-20">
          <div className="hidden items-center justify-between lg:flex"><Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-gray-600 transition hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gray-400"><ArrowLeft size={16} />กลับหน้าแรก</Link><span aria-hidden="true" /></div>
          <div className="w-full max-w-md lg:m-auto lg:py-12">
            <p className="text-center text-[11px] font-semibold tracking-[0.14em] text-[#3f5f80] lg:text-left lg:font-black lg:tracking-[0.18em] lg:text-blue-700">WELCOME BACK</p><h2 className="mt-1.5 text-center text-[26px] font-medium tracking-[-0.01em] text-ink lg:mt-3 lg:text-left lg:text-4xl lg:font-black lg:tracking-[-0.055em] lg:text-gray-900">เข้าสู่ระบบ</h2><p className="mt-3 hidden text-sm leading-6 text-gray-600 lg:block">ใช้บัญชีของคุณเพื่อดูสถานะน้ำยาและงานที่ต้องดำเนินการ</p>
            <form onSubmit={handleSubmit} className="mt-5 space-y-3.5 lg:mt-8 lg:space-y-5">
              {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-[#f1c5c1] bg-[#fff4f2] p-4 text-sm font-semibold leading-6 text-[#a33b35]"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}
              <div className="space-y-2"><label htmlFor="login-identifier" className="text-[13px] font-medium text-gray-900 lg:text-sm lg:font-bold">อีเมลหรือชื่อผู้ใช้</label><div className="relative"><UserRound className="absolute left-4 hidden lg:block top-1/2 -translate-y-1/2 text-gray-500" size={18} /><input id="login-identifier" name="username" type="text" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="เช่น medtech01" className="min-h-12 w-full rounded-xl border border-line bg-white pl-3.5 pr-4 lg:min-h-14 lg:rounded-2xl lg:border-gray-300 lg:bg-gray-50 lg:pl-12 text-sm font-semibold text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-gray-400 focus:bg-white focus:ring-4 focus:ring-gray-400/10" /></div></div>
              <div className="space-y-2"><label htmlFor="login-password" className="text-[13px] font-medium text-gray-900 lg:text-sm lg:font-bold">รหัสผ่าน</label><div className="relative"><KeyRound className="absolute left-4 hidden lg:block top-1/2 -translate-y-1/2 text-gray-500" size={18} /><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="กรอกรหัสผ่าน" className="min-h-12 w-full rounded-xl border border-line bg-white pl-3.5 pr-12 lg:min-h-14 lg:rounded-2xl lg:border-gray-300 lg:bg-gray-50 lg:pl-12 text-sm font-semibold text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-gray-400 focus:bg-white focus:ring-4 focus:ring-gray-400/10" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-xl text-gray-600 transition hover:bg-gray-100 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
              <div className="flex items-center justify-between gap-4 text-xs font-semibold"><label className="flex items-center gap-2 text-gray-600"><input type="checkbox" className="size-4 rounded border-gray-400 accent-ink lg:accent-blue-700" />จดจำฉันในระบบ</label><Link href="/reset-password" className="font-medium text-ink! hover:underline lg:font-bold lg:text-blue-700! lg:no-underline lg:hover:text-gray-900!">ลืมรหัสผ่าน?</Link></div>
              <button type="submit" disabled={isBusy} className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-ink text-[15px] font-medium text-white transition hover:bg-black lg:min-h-14 lg:rounded-2xl lg:bg-gray-900 lg:text-sm lg:font-black lg:shadow-xl lg:shadow-gray-900/20 lg:hover:bg-gray-900 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-800">{loading ? <Loader2 className="animate-spin" size={20} /> : 'เข้าสู่ระบบ'}</button>
              <div className="flex items-center gap-3"><div className="h-px flex-1 bg-line lg:bg-gray-100" /><span className="text-[10px] font-black tracking-[0.14em] text-gray-500">หรือ</span><div className="h-px flex-1 bg-line lg:bg-gray-100" /></div>
              <button type="button" onClick={handleGoogleLogin} disabled={isBusy} className="inline-flex min-h-[50px] w-full items-center justify-center gap-3 rounded-xl border border-line bg-white text-[15px] font-medium text-ink lg:min-h-14 lg:rounded-2xl lg:border-gray-300 lg:text-sm lg:font-black lg:text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">{googleLoading ? <Loader2 className="animate-spin" size={20} /> : <span className="text-[17px] font-bold text-ink lg:text-lg lg:font-black lg:text-[#4285f4]">G</span>}เข้าสู่ระบบด้วย Google</button>
              <p className="pt-1 text-center text-[13px] text-ink-muted lg:pt-2 lg:text-sm lg:font-semibold lg:text-gray-600">ยังไม่มีบัญชี? <Link href="/register" className="font-medium text-ink! underline underline-offset-4 lg:font-black lg:text-blue-700! lg:decoration-gray-300 lg:hover:text-gray-900!">ลงทะเบียนด้วยอีเมล</Link></p>
            </form>
          </div>
          <p className="mt-4 hidden text-center text-[10px] font-semibold tracking-wide text-gray-500 lg:block">LabStock · ระบบบริหารคลังน้ำยาเครื่องตรวจ</p>
        </section>
      </div>
    </main>
  );
}
