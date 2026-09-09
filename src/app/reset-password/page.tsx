'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react';

type Mode = 'request' | 'confirm';

export default function ResetPasswordPage() {
  const [mode] = useState<Mode>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('token') ? 'confirm' : 'request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true); setError(''); setSuccess('');
    try {
      const response = await fetch('/api/auth/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await response.json() as { message?: string };
      setSuccess(data.message || 'หากอีเมลนี้อยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่แล้ว');
    } catch {
      setSuccess('หากอีเมลนี้อยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่แล้ว');
    } finally { setLoading(false); }
  };

  const submitConfirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(''); setSuccess('');
    if (password !== confirmPassword) { setError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน'); return; }
    setLoading(true);
    try {
      const token = new URLSearchParams(window.location.search).get('token');
      const response = await fetch('/api/auth/password-reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
      const data = await response.json() as { success?: boolean; message?: string; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || 'ไม่สามารถตั้งรหัสผ่านใหม่ได้');
      setSuccess(data.message || 'ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว');
    } catch (requestError: unknown) { setError(requestError instanceof Error ? requestError.message : 'ไม่สามารถตั้งรหัสผ่านใหม่ได้'); }
    finally { setLoading(false); }
  };

  const isConfirm = mode === 'confirm';
  return <main className="min-h-screen bg-[#f4fafb] p-5 text-[#102a43] sm:p-10"><section className="mx-auto mt-8 w-full max-w-md rounded-[2rem] border border-[#c9e1e3] bg-white p-7 shadow-xl sm:p-10"><div className="flex size-14 items-center justify-center rounded-2xl bg-[#0b8f8c] text-white"><ShieldCheck size={28} /></div><p className="mt-6 text-[11px] font-black tracking-[0.16em] text-[#0b8f8c]">ACCOUNT SECURITY</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{isConfirm ? 'ตั้งรหัสผ่านใหม่' : 'ลืมรหัสผ่าน?'}</h1><p className="mt-3 text-sm leading-6 text-[#5d7378]">{isConfirm ? 'ตั้งรหัสผ่านใหม่อย่างน้อย 12 ตัวอักษร หลังบันทึกแล้วจะต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์' : 'กรอกอีเมลที่ผูกกับบัญชี แล้วเราจะส่งลิงก์ใช้ครั้งเดียวให้คุณ'}</p>{error && <div role="alert" className="mt-6 flex gap-3 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700"><AlertCircle className="shrink-0" size={18} />{error}</div>}{success && <div role="status" className="mt-6 flex gap-3 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 className="shrink-0" size={18} />{success}</div>}{isConfirm ? <form onSubmit={submitConfirm} className="mt-7 space-y-5"><label className="block text-sm font-bold">รหัสผ่านใหม่<input className="mt-2 min-h-13 w-full rounded-2xl border border-[#c9e1e3] bg-[#f8fcfc] px-4" type="password" minLength={12} maxLength={256} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="block text-sm font-bold">ยืนยันรหัสผ่าน<input className="mt-2 min-h-13 w-full rounded-2xl border border-[#c9e1e3] bg-[#f8fcfc] px-4" type="password" minLength={12} maxLength={256} autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><button disabled={loading || Boolean(success)} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#0b8f8c] font-black text-white disabled:opacity-60">{loading ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />}บันทึกรหัสผ่านใหม่</button></form> : <form onSubmit={submitRequest} className="mt-7 space-y-5"><label className="block text-sm font-bold">อีเมล<input className="mt-2 min-h-13 w-full rounded-2xl border border-[#c9e1e3] bg-[#f8fcfc] px-4" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><button disabled={loading} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#0b8f8c] font-black text-white disabled:opacity-60">{loading ? <Loader2 className="animate-spin" size={18} /> : <Mail size={18} />}ส่งลิงก์ตั้งรหัสผ่านใหม่</button></form>}<div className="mt-7 text-center text-sm font-semibold"><Link href="/login" className="text-[#0b8f8c] underline underline-offset-4">กลับหน้าเข้าสู่ระบบ</Link></div></section></main>;
}
