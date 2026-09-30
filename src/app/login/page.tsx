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
    <main className="min-h-screen bg-ground pb-6 text-ink lg:p-3 lg:pb-3">
      <div className="mx-auto grid max-w-[480px] gap-0 px-[18px] pt-3 lg:min-h-[calc(100vh-24px)] lg:max-w-none lg:grid-cols-[1.065fr_1fr] lg:gap-3 lg:p-0">
        <section aria-label="LabStock · SPR LAB" className="relative flex min-h-[170px] flex-col items-center justify-center gap-2.5 overflow-hidden rounded-[20px] bg-gray-950 px-[22px] py-5 text-center text-white lg:hidden">
          <Image src="/images/labstock-clinical-inventory-hero.png" alt="" fill sizes="480px" priority className="object-cover object-right" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,22,34,0.7),rgba(10,22,34,0.94))]" />
          <div className="relative flex flex-col items-center gap-2.5"><Image src="/images/logo-spr-lab.png" alt="โลโก้ SPR LAB" width={72} height={72} priority className="size-[72px] rounded-2xl ring-1 ring-white/25" /><h1 className="text-xl font-semibold tracking-[-0.01em]">LabStock · SPR LAB</h1><p className="mt-1 text-xs text-[#c9d2db]">กลุ่มงานเทคนิคการแพทย์และพยาธิวิทยาคลินิก</p></div>
        </section>
        <section className="relative hidden min-h-[560px] overflow-hidden rounded-3xl bg-gray-950 text-white lg:block">
          <Image src="/images/labstock-clinical-inventory-hero.png" alt="ชั้นวางน้ำยาและอุปกรณ์สำหรับเครื่องตรวจวิเคราะห์อัตโนมัติ" fill sizes="(max-width: 1024px) 0vw, 55vw" className="object-cover object-right" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,22,34,0.92)_0%,rgba(10,22,34,0.72)_45%,rgba(10,22,34,0.15)_100%)]" />
          <div className="relative flex h-full min-h-[560px] flex-col justify-between gap-8 px-11 py-10">
            <Link href="/" className="flex w-fit items-center gap-3.5 text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300"><Image src="/images/logo-spr-lab.png" alt="โลโก้ SPR LAB" width={72} height={72} className="size-[72px] rounded-2xl ring-1 ring-white/20" /><span><span className="block text-[22px] font-semibold">LabStock · SPR LAB</span><span className="block text-[13px] text-gray-300">กลุ่มงานเทคนิคการแพทย์และพยาธิวิทยาคลินิก</span><span className="block text-[13px] text-gray-300">โรงพยาบาลสวรรค์ประชารักษ์</span></span></Link>
            <div className="max-w-[520px]"><p className="mb-[18px] text-xs tracking-[0.16em] text-gray-400">SECURE LAB OPERATIONS</p><h1 className="text-[54px] font-medium leading-[1.08] tracking-[-0.02em]">คลังน้ำยาที่ทีมแล็บ<br /><span className="text-blue-300">ไว้ใจได้</span></h1><p className="mt-5 text-base leading-[1.7] text-gray-300">ติดตามน้ำยาสำหรับเครื่องตรวจวิเคราะห์อัตโนมัติ ตั้งแต่รับเข้า lot วันหมดอายุ จนถึงการเบิกใช้</p></div>
            <div className="grid grid-cols-3 gap-2.5">{[['FEFO', 'เบิก lot ที่หมดอายุก่อน'], ['GS1', 'แสกนบาร์โค้ดรับเข้า'], ['RBAC', 'สิทธิ์ตามบทบาท']].map(([title, note]) => <div key={title} className="rounded-[14px] border border-white/[0.18] bg-[rgba(10,22,34,0.45)] p-3.5 backdrop-blur-[6px]"><p className="text-[26px] font-medium">{title}</p><p className="text-[13px] text-gray-400">{note}</p></div>)}</div>
            <div className="flex items-center gap-2.5 text-sm text-gray-300"><LockKeyhole size={18} />ข้อมูลการเข้าใช้ถูกตรวจสอบตามบัญชีผู้ใช้งาน</div>
          </div>
        </section>

        <section className="relative -mt-2.5 flex flex-col rounded-[20px] border border-line bg-white px-5 py-[22px] lg:mt-0 lg:min-h-[560px] lg:rounded-3xl lg:px-8 lg:py-7">
          <div className="hidden items-center text-sm text-gray-600 lg:flex"><Link href="/" className="inline-flex items-center gap-1.5 text-gray-600! transition hover:text-ink! focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gray-400"><ArrowLeft size={16} />กลับหน้าแรก</Link></div>
          <div className="w-full max-w-md lg:m-auto lg:max-w-[420px] lg:py-8">
            <p className="text-center text-[11px] font-semibold tracking-[0.14em] text-[#3f5f80] lg:text-left lg:text-xs lg:font-normal lg:tracking-[0.16em]">WELCOME BACK</p><h2 className="mt-1.5 text-center text-[26px] font-medium tracking-[-0.01em] text-ink lg:mt-2 lg:text-left lg:text-4xl lg:tracking-normal">เข้าสู่ระบบ</h2><p className="mt-1.5 hidden text-[15px] text-gray-600 lg:block">ใช้บัญชีของคุณเพื่อดูสถานะน้ำยาและงานที่ต้องดำเนินการ</p>
            <form onSubmit={handleSubmit} className="mt-5 space-y-3.5 lg:mt-[18px] lg:space-y-[18px]">
              {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#f1c5c1] bg-[#fff4f2] px-3.5 py-3 text-sm font-medium leading-6 text-[#a33b35]"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}
              <div className="space-y-1.5"><label htmlFor="login-identifier" className="text-[13px] font-medium text-ink lg:text-sm">อีเมลหรือชื่อผู้ใช้</label><div className="relative"><UserRound className="absolute left-3.5 top-[15px] hidden text-gray-500 lg:block" size={18} /><input id="login-identifier" name="username" type="text" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="เช่น medtech01" className="min-h-12 w-full rounded-xl border border-line bg-white pl-3.5 pr-4 text-sm text-ink outline-none transition placeholder:text-gray-500 focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10 lg:pl-11 lg:text-[15px]" /></div></div>
              <div className="space-y-1.5"><label htmlFor="login-password" className="text-[13px] font-medium text-ink lg:text-sm">รหัสผ่าน</label><div className="relative"><KeyRound className="absolute left-3.5 top-[15px] hidden text-gray-500 lg:block" size={18} /><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="กรอกรหัสผ่าน" className="min-h-12 w-full rounded-xl border border-line bg-white pl-3.5 pr-12 text-sm text-ink outline-none transition placeholder:text-gray-500 focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10 lg:pl-11 lg:text-[15px]" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-xl text-gray-600 transition hover:bg-gray-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
              <div className="flex items-center justify-between gap-4 text-xs lg:text-sm"><label className="flex items-center gap-2 text-gray-600"><input type="checkbox" defaultChecked className="size-4 rounded border-gray-400 accent-ink" />จดจำฉันในระบบ</label><Link href="/reset-password" className="font-medium text-ink! hover:underline">ลืมรหัสผ่าน?</Link></div>
              <button type="submit" disabled={isBusy} className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-ink text-[15px] font-medium text-white transition hover:bg-black active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-800">{loading ? <Loader2 className="animate-spin" size={20} /> : 'เข้าสู่ระบบ'}</button>
              <div className="flex items-center gap-3"><div className="h-px flex-1 bg-line" /><span className="text-xs tracking-[0.14em] text-gray-500">หรือ</span><div className="h-px flex-1 bg-line" /></div>
              <button type="button" onClick={handleGoogleLogin} disabled={isBusy} className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-line bg-white text-[15px] font-medium text-ink transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">{googleLoading ? <Loader2 className="animate-spin" size={20} /> : <span className="text-[17px] font-bold text-ink">G</span>}เข้าสู่ระบบด้วย Google</button>
              <p className="pt-1 text-center text-[13px] text-ink-muted lg:pt-0 lg:text-sm lg:text-gray-600">ยังไม่มีบัญชี? <Link href="/register" className="font-medium text-ink! underline underline-offset-4">ลงทะเบียนด้วยอีเมล</Link></p>
            </form>
          </div>
          <p className="mt-4 hidden text-xs text-gray-500 lg:block">LabStock · ระบบบริหารคลังน้ำยาเครื่องตรวจ</p>
        </section>
      </div>
    </main>
  );
}
