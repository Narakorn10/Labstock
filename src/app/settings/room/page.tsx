'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Lock, RefreshCw, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { ErrorNotice } from '@/components/error-notice';
import type { ApiErrorInfo } from '@/lib/api-errors-client';
import {
  ROOM_ASSIGNABLE_ROLES,
  approvePending,
  listMembers,
  listPending,
  removeMember,
  ROLE_LABELS,
  roomRoleLabel,
  saveMember,
  type PendingUser,
  type RoomAssignableRole,
  type RoomMember,
  type RoomResult,
} from '@/lib/room-admin-client';

const STATUS_LABELS: Record<string, string> = { active: 'ใช้งานอยู่', pending: 'รออนุมัติ', suspended: 'ระงับอยู่' };

export default function RoomAdminPage() {
  const { user, loading: authLoading, departmentContext } = useAuth();
  // The room is always the one the user is working in (from /api/auth/me); the server checks it again.
  const roomId = typeof departmentContext?.scope === 'number' ? departmentContext.scope : null;
  const roomName = departmentContext?.active?.name ?? '';

  const [pending, setPending] = useState<PendingUser[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<RoomAssignableRole | ''>('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async (id: number) => {
    const [pendingResult, memberResult] = await Promise.all([listPending(id), listMembers(id)]);
    if (!pendingResult.ok) setError(pendingResult.error);
    else if (!memberResult.ok) setError(memberResult.error);
    else {
      setError(null);
      setPending(pendingResult.data);
      setMembers(memberResult.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (roomId === null) return;
    // The department context (from /api/auth/me) is the external system being synchronized here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(roomId);
  }, [roomId, load]);

  const run = async (key: string, action: () => Promise<RoomResult<unknown>>, success: string) => {
    if (roomId === null || busy) return;
    setBusy(key);
    setNotice('');
    const result = await action();
    if (result.ok) {
      setNotice(success);
      await load(roomId);
    } else {
      setError(result.error);
    }
    setBusy('');
    return result.ok;
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (roomId === null) return;
    const username = newUsername.trim();
    if (!username) return;
    const ok = await run(`add:${username}`, () => saveMember(roomId, username, newRole || null), `เพิ่ม ${username} เข้าห้องแล้ว`);
    if (ok) {
      setNewUsername('');
      setNewRole('');
    }
  };

  if (authLoading || !user || (departmentContext === null && !error)) {
    return <div className="p-8 text-sm text-ink-muted" role="status">กำลังโหลด…</div>;
  }

  if (roomId === null) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 text-center">
        <Lock className="text-amber-600" size={44} />
        <h1 className="text-xl font-bold text-slate-900">กรุณาเลือกห้องก่อน</h1>
        <p className="mt-1 max-w-md text-sm text-ink-muted">หน้านี้ใช้ได้เมื่อระบบหลายห้องเปิดอยู่และคุณกำลังทำงานในห้องใดห้องหนึ่ง (ไม่ใช่โหมดดูทุกห้อง)</p>
      </div>
    );
  }

  if (error?.status === 403) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 text-center">
        <Lock className="text-rose-600" size={44} />
        <h1 className="text-xl font-bold text-slate-900">ไม่มีสิทธิ์เข้าถึง</h1>
        <p className="mt-1 max-w-md text-sm text-ink-muted">เฉพาะผู้ดูแลห้อง (หรือผู้ดูแลระบบที่เลือกห้องนี้อยู่) เท่านั้นที่จัดการสมาชิกห้องได้ ผู้ดูแลระบบเป็นผู้แต่งตั้งผู้ดูแลห้อง</p>
      </div>
    );
  }

  return (
    <main className="space-y-6 pb-16">
      <header className="flex flex-col justify-between gap-3 border-b border-gray-300 pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Room admin</p>
          <h1 className="mt-1 text-[28px] leading-tight font-medium tracking-tight text-ink">ห้องของฉัน{roomName ? `: ${roomName}` : ''}</h1>
          <p className="mt-1 text-sm text-ink-muted">อนุมัติผู้สมัครและจัดการสมาชิกของห้องนี้ การแต่งตั้งผู้ดูแลห้องทำโดยผู้ดูแลระบบ</p>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); void load(roomId); }}
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

      <section aria-labelledby="pending-heading" className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 id="pending-heading" className="text-lg font-bold text-gray-900">ผู้สมัครรออนุมัติ ({pending.length})</h2>
        <p className="mt-1 text-xs text-gray-500">แสดงเฉพาะผู้สมัครบัญชีผู้ใช้ทั่วไปที่เลือกห้องนี้ บัญชีบริษัทคู่ค้าและบทบาทอื่นให้ผู้ดูแลระบบอนุมัติ</p>
        {pending.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">{loading ? 'กำลังโหลด…' : 'ไม่มีผู้สมัครที่รออนุมัติ'}</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {pending.map((person) => (
              <li key={person.username} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-gray-900">{person.name || person.username}</p>
                  <p className="text-xs text-gray-500">{person.username}{person.email ? ` · ${person.email}` : ''}</p>
                </div>
                <button
                  type="button"
                  disabled={busy !== ''}
                  onClick={() => void run(`approve:${person.username}`, () => approvePending(roomId, person.username), `อนุมัติ ${person.username} แล้ว`)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <UserCheck size={16} aria-hidden="true" /> อนุมัติ
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="members-heading" className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 id="members-heading" className="text-lg font-bold text-gray-900">สมาชิกของห้อง ({members.length})</h2>
        <p className="mt-1 text-xs text-gray-500">บทบาทในห้องมีผลเฉพาะห้องนี้ ผู้ถูกเพิ่มไม่ต้องยืนยัน และถอดไม่ได้ถ้าเป็นผู้ดูแลห้องหรือเป็นห้องสุดท้ายของผู้ใช้</p>

        <form onSubmit={handleAdd} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-gray-50 p-4">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="room-add-username" className="text-xs font-bold text-gray-600">ชื่อผู้ใช้ (username)</label>
            <input
              id="room-add-username"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              maxLength={80}
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="room-add-role" className="text-xs font-bold text-gray-600">บทบาทในห้องนี้</label>
            <select
              id="room-add-role"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as RoomAssignableRole | '')}
              className="mt-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">ตามบทบาทเดิมของผู้ใช้</option>
              {ROOM_ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]} ({role})</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy !== '' || newUsername.trim() === ''}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <UserPlus size={16} aria-hidden="true" /> เพิ่มเข้าห้อง
          </button>
        </form>

        {members.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">{loading ? 'กำลังโหลด…' : 'ยังไม่มีสมาชิก'}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">ผู้ใช้</th>
                  <th className="py-2 pr-3 font-medium">บทบาทในห้อง</th>
                  <th className="py-2 pr-3 font-medium">สถานะ</th>
                  <th className="py-2 text-right font-medium">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map((member) => {
                  const editable = member.globalRole !== 'Admin' && member.globalRole !== 'Vendor';
                  return (
                    <tr key={member.username}>
                      <td className="py-3 pr-3">
                        <p className="font-medium text-gray-900">
                          {member.name || member.username}
                          {member.isRoomAdmin && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">ผู้ดูแลห้อง</span>}
                        </p>
                        <p className="text-xs text-gray-500">{member.username}{member.isDefault ? ' · ห้องหลัก' : ''}</p>
                      </td>
                      <td className="py-3 pr-3">
                        {editable ? (
                          <select
                            aria-label={`บทบาทของ ${member.username} ในห้องนี้`}
                            value={member.roomRole ?? ''}
                            disabled={busy !== ''}
                            onChange={(event) => {
                              const role = (event.target.value || null) as RoomAssignableRole | null;
                              void run(`role:${member.username}`, () => saveMember(roomId, member.username, role), `เปลี่ยนบทบาทของ ${member.username} แล้ว`);
                            }}
                            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm"
                          >
                            <option value="">ตามบทบาทเดิม ({ROLE_LABELS[member.globalRole] ?? member.globalRole})</option>
                            {ROOM_ASSIGNABLE_ROLES.map((role) => (
                              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                            ))}
                          </select>
                        ) : (
                          <span>{roomRoleLabel(member)}</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-gray-700">{STATUS_LABELS[member.accountStatus ?? ''] ?? member.accountStatus ?? '-'}</td>
                      <td className="py-3 text-right">
                        {member.isRoomAdmin || member.username === user.username ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : confirmRemove === member.username ? (
                          <span className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busy !== ''}
                              onClick={() => { setConfirmRemove(null); void run(`remove:${member.username}`, () => removeMember(roomId, member.username), `ถอด ${member.username} ออกจากห้องแล้ว`); }}
                              className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              ยืนยันถอด
                            </button>
                            <button type="button" onClick={() => setConfirmRemove(null)} className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700">ยกเลิก</button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy !== ''}
                            onClick={() => setConfirmRemove(member.username)}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <UserMinus size={14} aria-hidden="true" /> ถอดออก
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
