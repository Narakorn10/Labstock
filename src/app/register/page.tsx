'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Database,
  KeyRound,
  Loader2,
  Mail,
  User,
} from 'lucide-react';

type AccountType = 'lab' | 'vendor';
type VendorMode = 'existing' | 'request';

type RegistrationOptions = {
  vendors?: string[];
  error?: string;
};

type RegistrationResponse = {
  success?: boolean;
  message?: string;
  error?: string;
};

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('lab');
  const [vendorMode, setVendorMode] = useState<VendorMode>('existing');
  const [vendorName, setVendorName] = useState('');
  const [vendorRequest, setVendorRequest] = useState('');
  const [vendors, setVendors] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadOptions = async () => {
      try {
        const response = await fetch('/api/auth/register');
        const data = await response.json() as RegistrationOptions;
        if (!response.ok) {
          throw new Error(data.error || 'ไม่สามารถโหลดรายชื่อบริษัทที่ได้รับอนุมัติได้');
        }

        if (!cancelled) {
          setVendors(data.vendors || []);
        }
      } catch (requestError: unknown) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'ไม่สามารถโหลดรายชื่อบริษัทที่ได้รับอนุมัติได้');
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    };

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (password !== confirmPassword) {
      setError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          username,
          password,
          accountType,
          vendorMode: accountType === 'vendor' ? vendorMode : undefined,
          vendorName: accountType === 'vendor' && vendorMode === 'existing' ? vendorName : undefined,
          vendorRequest: accountType === 'vendor' && vendorMode === 'request' ? vendorRequest : undefined,
        }),
      });
      const data = await response.json() as RegistrationResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'ไม่สามารถลงทะเบียนได้ในขณะนี้');
      }

      setSuccess(data.message || 'ลงทะเบียนสำเร็จ บัญชีของคุณอยู่ระหว่างรอการอนุมัติ');
      setPassword('');
      setConfirmPassword('');
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'ไม่สามารถลงทะเบียนได้ในขณะนี้');
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = submitting || loadingOptions;

  return (
    <main className="min-h-screen bg-gray-50 p-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-xl space-y-7">
        <header className="text-center">
          <div className="mb-5 inline-flex size-16 items-center justify-center rounded-2xl bg-ink text-white shadow-xl">
            <Database size={32} aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">ลงทะเบียน LabStock</h1>
          <p className="mt-2 text-sm font-medium leading-6 text-gray-500">
            สร้างบัญชีด้วยอีเมลเพื่อส่งคำขอใช้งานระบบคลังน้ำยา
          </p>
        </header>

        <section aria-labelledby="register-heading" className="rounded-[20px] border border-gray-100 bg-white p-6 shadow-xl sm:p-8">
          <h2 id="register-heading" className="sr-only">แบบฟอร์มลงทะเบียน</h2>

          {error && (
            <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700">
              <AlertCircle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
              <p>{error}</p>
            </div>
          )}

          {success && (
            <div role="status" aria-live="polite" className="mb-6 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">
              <CheckCircle2 className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
              <p>{success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <fieldset disabled={disabled} className="space-y-5 disabled:opacity-60">
              <legend className="text-sm font-black text-gray-800">ข้อมูลสำหรับเข้าสู่ระบบ</legend>

              <div className="space-y-2">
                <label htmlFor="register-name" className="ml-1 text-xs font-bold text-gray-600">ชื่อ-นามสกุล</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} aria-hidden="true" />
                  <input
                    id="register-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 pl-12 pr-4 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="register-email" className="ml-1 text-xs font-bold text-gray-600">อีเมล</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} aria-hidden="true" />
                  <input
                    id="register-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 pl-12 pr-4 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="register-username" className="ml-1 text-xs font-bold text-gray-600">ชื่อผู้ใช้</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} aria-hidden="true" />
                  <input
                    id="register-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={64}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    aria-describedby="register-username-hint"
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 pl-12 pr-4 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p id="register-username-hint" className="ml-1 text-xs text-gray-500">3-64 ตัวอักษร และไม่มีช่องว่าง</p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="register-password" className="ml-1 text-xs font-bold text-gray-600">รหัสผ่าน</label>
                  <div className="relative">
                    <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} aria-hidden="true" />
                    <input
                      id="register-password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={256}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 pl-12 pr-4 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="register-password-confirm" className="ml-1 text-xs font-bold text-gray-600">ยืนยันรหัสผ่าน</label>
                  <div className="relative">
                    <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} aria-hidden="true" />
                    <input
                      id="register-password-confirm"
                      name="password-confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={256}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 pl-12 pr-4 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </fieldset>

            <fieldset disabled={disabled} className="space-y-3 border-t border-gray-100 pt-5 disabled:opacity-60">
              <legend className="text-sm font-black text-gray-800">ประเภทบัญชี</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={`cursor-pointer rounded-2xl border p-4 transition ${accountType === 'lab' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input
                    type="radio"
                    name="accountType"
                    value="lab"
                    checked={accountType === 'lab'}
                    onChange={() => setAccountType('lab')}
                    className="sr-only"
                  />
                  <span className="block text-sm font-black text-gray-900">บุคลากรห้องปฏิบัติการ</span>
                  <span className="mt-1 block text-xs leading-5 text-gray-600">ส่งคำขอบัญชีผู้ใช้งาน LabStock</span>
                </label>
                <label className={`cursor-pointer rounded-2xl border p-4 transition ${accountType === 'vendor' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input
                    type="radio"
                    name="accountType"
                    value="vendor"
                    checked={accountType === 'vendor'}
                    onChange={() => setAccountType('vendor')}
                    className="sr-only"
                  />
                  <span className="block text-sm font-black text-gray-900">บริษัทผู้จำหน่าย</span>
                  <span className="mt-1 block text-xs leading-5 text-gray-600">ผูกกับบริษัทที่ได้รับอนุมัติเท่านั้น</span>
                </label>
              </div>

              {accountType === 'vendor' && (
                <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                  <div className="flex items-start gap-3 text-sm text-blue-950">
                    <Building2 className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
                    <p className="font-medium leading-6">เลือกบริษัทที่ได้รับอนุมัติ หรือส่งคำขอเพิ่มบริษัท การส่งคำขอจะไม่ผูกบัญชีกับบริษัทจนกว่าผู้ดูแลอนุมัติ</p>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-700">
                      <input type="radio" name="vendorMode" value="existing" checked={vendorMode === 'existing'} onChange={() => setVendorMode('existing')} />
                      เลือกบริษัทที่ได้รับอนุมัติ
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-700">
                      <input type="radio" name="vendorMode" value="request" checked={vendorMode === 'request'} onChange={() => setVendorMode('request')} />
                      ขอเพิ่มบริษัท
                    </label>
                  </div>

                  {vendorMode === 'existing' ? (
                    <div className="space-y-2">
                      <label htmlFor="register-vendor" className="text-xs font-bold text-gray-600">บริษัทที่ได้รับอนุมัติ</label>
                      <select
                        id="register-vendor"
                        value={vendorName}
                        onChange={(event) => setVendorName(event.target.value)}
                        required={accountType === 'vendor' && vendorMode === 'existing'}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-medium text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">เลือกบริษัท</option>
                        {vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
                      </select>
                      {!loadingOptions && vendors.length === 0 && <p className="text-xs text-amber-700">ยังไม่มีบริษัทที่ได้รับอนุมัติ กรุณาเลือก “ขอเพิ่มบริษัท”</p>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label htmlFor="register-vendor-request" className="text-xs font-bold text-gray-600">ชื่อบริษัทที่ต้องการขอเพิ่ม</label>
                      <input
                        id="register-vendor-request"
                        type="text"
                        required={accountType === 'vendor' && vendorMode === 'request'}
                        maxLength={120}
                        value={vendorRequest}
                        onChange={(event) => setVendorRequest(event.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-medium text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>
              )}
            </fieldset>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
              <p className="font-black">ข้อกำหนดก่อนใช้งานจริง</p>
              <p className="mt-1">บัญชีใหม่จะรอการอนุมัติ และในระยะนี้ยังไม่มีการยืนยันอีเมลหรือการรีเซ็ตรหัสผ่าน</p>
            </div>

            <button
              type="submit"
              disabled={disabled || Boolean(success)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 py-4 text-sm font-black text-white shadow-xl transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 className="animate-spin" size={20} aria-hidden="true" /> : 'ส่งคำขอลงทะเบียน'}
            </button>
          </form>
        </section>

        <p className="text-center text-sm text-gray-600">
          มีบัญชีอยู่แล้ว?{' '}
          <Link href="/login" className="font-bold text-blue-600 underline underline-offset-4 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm">
            กลับไปเข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </main>
  );
}
