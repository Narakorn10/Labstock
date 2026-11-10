'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Lock, RefreshCw } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { ErrorNotice } from '@/components/error-notice';
import type { ApiErrorInfo } from '@/lib/api-errors-client';
import { createAdminLetterhead, createAdminRoom, listAdminRooms, updateAdminRoom, type AdminRoom, type RoomsResult } from '@/lib/super-admin-rooms-client';

const DEFAULT_CODE = 'CC';
const inputClass = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500';

export default function SuperAdminRoomsPage() {
  const { user, loading: authLoading, isSuperAdmin = false, accountContextLoaded = false } = useAuth();
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [newName, setNewName] = useState('');
  const [newOrganization, setNewOrganization] = useState('');
  // Drafts are keyed by room id; a room with no draft shows its saved value.
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});
  const [codeDrafts, setCodeDrafts] = useState<Record<number, string>>({});
  const [letterheadDrafts, setLetterheadDrafts] = useState<Record<number, string>>({});
  const [confirmClose, setConfirmClose] = useState<number | null>(null);

  const load = useCallback(async () => {
    const result = await listAdminRooms();
    if (result.ok) {
      setError(null);
      setRooms(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    // The room list lives on the server; this effect is what synchronizes it into the page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [isSuperAdmin, load]);

  const run = async (key: string, action: () => Promise<RoomsResult<unknown>>, success: string) => {
    if (busy) return false;
    setBusy(key);
    setNotice('');
    const result = await action();
    let ok = false;
    if (result.ok) {
      ok = true;
      setNotice(success);
      setConfirmClose(null);
      await load();
    } else {
      setError(result.error);
    }
    setBusy('');
    return ok;
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    const organizationName = newOrganization.trim();
    if (!name || !organizationName) return;
    const ok = await run('create', () => createAdminRoom({ name, organizationName }), `สร้างห้อง "${name}" แล้ว (ยังปิดอยู่ และยังไม่มีรหัส)`);
    if (ok) {
      setNewName('');
      setNewOrganization('');
    }
  };

  const handleClose = async (room: AdminRoom, confirmed: boolean) => {
    if (busy) return;
    setBusy(`close:${room.id}`);
    setNotice('');
    const result = await updateAdminRoom(room.id, { isActive: false, ...(confirmed ? { confirmDeactivate: true } : {}) });
    if (result.ok) {
      setError(null);
      setNotice(`ปิดห้อง "${room.name}" แล้ว สมาชิกและข้อมูลยังอยู่ครบ`);
      setConfirmClose(null);
      await load();
    } else if (result.needsConfirmation) {
      setError(null);
      setConfirmClose(room.id);
    } else {
      setError(result.error);
    }
    setBusy('');
  };

  if (authLoading || !user || !accountContextLoaded) {
    return <div className="p-8 text-sm text-ink-muted" role="status">กำลังโหลด…</div>;
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 text-center">
        <Lock className="text-rose-600" size={44} />
        <h1 className="text-xl font-bold text-slate-900">ไม่มีสิทธิ์เข้าถึง</h1>
        <p className="mt-1 max-w-md text-sm text-ink-muted">หน้านี้สำหรับ Super admin เท่านั้น</p>
      </div>
    );
  }

  return (
    <main className="space-y-6 pb-16">
      <header className="flex flex-col justify-between gap-3 border-b border-gray-300 pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Super admin</p>
          <h1 className="mt-1 text-[28px] leading-tight font-medium tracking-tight text-ink">จัดการห้อง</h1>
          <p className="mt-1 text-sm text-ink-muted">สร้างห้อง ตั้งรหัส เปลี่ยนชื่อ และเปิด/ปิดห้อง ห้องไม่ถูกลบ ปิดได้อย่างเดียว ห้อง {DEFAULT_CODE} แก้หรือปิดจากหน้านี้ไม่ได้</p>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); void load(); }}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={16} aria-hidden="true" /> รีเฟรช
        </button>
      </header>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {notice && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 size={18} aria-hidden="true" /> {notice}
        </div>
      )}

      <section aria-labelledby="create-heading" className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 id="create-heading" className="text-lg font-bold text-gray-900">สร้างห้องใหม่</h2>
        <p className="mt-1 text-xs text-gray-500">ห้องใหม่เริ่มเป็น &quot;ปิด&quot; และยังไม่มีรหัส ระบบสร้างหัวกระดาษใบสั่งซื้อของห้องให้ด้วยชื่อองค์กรที่กรอก (ไม่คัดลอกจากห้องอื่น) ที่อยู่/โทร/อีเมลให้ผู้ดูแลห้องกรอกเพิ่มทีหลัง</p>
        <form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-gray-50 p-4">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="new-room-name" className="text-xs font-bold text-gray-600">ชื่อห้อง</label>
            <input id="new-room-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={160} autoComplete="off" className={`mt-1 ${inputClass}`} />
          </div>
          <div className="min-w-[220px] flex-1">
            <label htmlFor="new-room-org" className="text-xs font-bold text-gray-600">ชื่อองค์กร (หัวกระดาษใบสั่งซื้อ)</label>
            <input id="new-room-org" value={newOrganization} onChange={(event) => setNewOrganization(event.target.value)} maxLength={160} autoComplete="off" className={`mt-1 ${inputClass}`} />
          </div>
          <button
            type="submit"
            disabled={busy !== '' || !newName.trim() || !newOrganization.trim()}
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            สร้างห้อง
          </button>
        </form>
      </section>

      <section aria-labelledby="rooms-heading" className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 id="rooms-heading" className="text-lg font-bold text-gray-900">ห้องทั้งหมด ({rooms.length})</h2>
        <p className="mt-1 text-xs text-gray-500">รหัสห้อง: ตัวพิมพ์ใหญ่หรือตัวเลข 2–10 ตัว ห้ามซ้ำ ห้ามใช้ LAB และ <strong>ตั้งแล้วเปลี่ยนไม่ได้</strong> ห้องจะเปิดได้เมื่อมีรหัสและมีหัวกระดาษ</p>
        {rooms.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">{loading ? 'กำลังโหลด…' : 'ยังไม่มีห้อง'}</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {rooms.map((room) => {
              const fixed = room.code === DEFAULT_CODE;
              const nameDraft = nameDrafts[room.id] ?? room.name;
              const codeDraft = codeDrafts[room.id] ?? '';
              const letterheadDraft = (letterheadDrafts[room.id] ?? '').trim();
              return (
                <li key={room.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{room.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${room.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{room.isActive ? 'เปิดอยู่' : 'ปิดอยู่'}</span>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">{room.code ?? 'ยังไม่มีรหัส'}</span>
                    <span className="text-xs text-gray-500">สมาชิก {room.memberCount} คน · {room.hasLetterhead ? 'มีหัวกระดาษ' : 'ยังไม่มีหัวกระดาษ'}</span>
                    {fixed && <span className="text-xs text-gray-500">ห้องเริ่มต้น แก้ไม่ได้</span>}
                  </div>

                  {!fixed && !room.hasLetterhead && (
                    <div className="flex flex-wrap items-end gap-3 rounded-xl bg-amber-50 p-3">
                      <div className="min-w-[220px] flex-1">
                        <label htmlFor={`room-letterhead-${room.id}`} className="text-xs font-bold text-amber-900">ห้องนี้ยังไม่มีหัวกระดาษใบสั่งซื้อ: กรอกชื่อองค์กรเพื่อสร้าง (ไม่คัดลอกจากห้องอื่น)</label>
                        <input id={`room-letterhead-${room.id}`} value={letterheadDrafts[room.id] ?? ''} onChange={(event) => setLetterheadDrafts((prev) => ({ ...prev, [room.id]: event.target.value }))} maxLength={160} autoComplete="off" className={`mt-1 ${inputClass}`} />
                      </div>
                      <button
                        type="button"
                        disabled={busy !== '' || letterheadDraft === ''}
                        onClick={() => void run(`letterhead:${room.id}`, () => createAdminLetterhead(room.id, letterheadDraft), `สร้างหัวกระดาษของ "${room.name}" แล้ว`)}
                        className="shrink-0 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        สร้างหัวกระดาษ
                      </button>
                    </div>
                  )}

                  {!fixed && (
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-[220px] flex-1">
                        <label htmlFor={`room-name-${room.id}`} className="text-xs font-bold text-gray-600">เปลี่ยนชื่อ</label>
                        <div className="mt-1 flex gap-2">
                          <input id={`room-name-${room.id}`} value={nameDraft} onChange={(event) => setNameDrafts((prev) => ({ ...prev, [room.id]: event.target.value }))} maxLength={160} className={inputClass} />
                          <button
                            type="button"
                            disabled={busy !== '' || nameDraft.trim() === '' || nameDraft.trim() === room.name}
                            onClick={() => void run(`name:${room.id}`, () => updateAdminRoom(room.id, { name: nameDraft.trim() }), 'เปลี่ยนชื่อห้องแล้ว')}
                            className="shrink-0 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            บันทึกชื่อ
                          </button>
                        </div>
                      </div>

                      {room.code === null && (
                        <div>
                          <label htmlFor={`room-code-${room.id}`} className="text-xs font-bold text-gray-600">ตั้งรหัส (ตั้งได้ครั้งเดียว{room.hasLetterhead ? '' : ' · สร้างหัวกระดาษก่อน'})</label>
                          <div className="mt-1 flex gap-2">
                            <input
                              id={`room-code-${room.id}`}
                              value={codeDraft}
                              onChange={(event) => setCodeDrafts((prev) => ({ ...prev, [room.id]: event.target.value.toUpperCase() }))}
                              maxLength={10}
                              autoComplete="off"
                              className={`${inputClass} w-36 uppercase`}
                            />
                            <button
                              type="button"
                              disabled={busy !== '' || codeDraft.trim().length < 2 || !room.hasLetterhead}
                              onClick={() => void run(`code:${room.id}`, () => updateAdminRoom(room.id, { code: codeDraft.trim() }), `ตั้งรหัส ${codeDraft.trim()} แล้ว`)}
                              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              ตั้งรหัส
                            </button>
                          </div>
                        </div>
                      )}

                      {room.isActive ? (
                        <button
                          type="button"
                          disabled={busy !== ''}
                          onClick={() => void handleClose(room, false)}
                          className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          ปิดห้อง
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy !== '' || room.code === null || !room.hasLetterhead}
                          onClick={() => void run(`open:${room.id}`, () => updateAdminRoom(room.id, { isActive: true }), `เปิดห้อง "${room.name}" แล้ว`)}
                          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          เปิดห้อง
                        </button>
                      )}
                    </div>
                  )}

                  {confirmClose === room.id && (
                    <div role="alertdialog" aria-label="ยืนยันการปิดห้อง" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <span>ห้องนี้มีสมาชิก {room.memberCount} คน ถ้าปิด สมาชิกจะเข้าห้องนี้ไม่ได้ (ข้อมูลและสมาชิกไม่ถูกลบ เปิดกลับได้เมื่อห้องมีรหัสและหัวกระดาษ) ยืนยันปิดห้อง?</span>
                      <button type="button" disabled={busy !== ''} onClick={() => void handleClose(room, true)} className="rounded-xl bg-rose-600 px-4 py-2 font-bold text-white hover:bg-rose-700 disabled:opacity-50">ยืนยันปิดห้อง</button>
                      <button type="button" onClick={() => setConfirmClose(null)} className="rounded-xl border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 hover:bg-gray-50">ยกเลิก</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
