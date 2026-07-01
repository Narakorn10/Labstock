'use client';

import { useEffect, useState } from 'react';
import { Check, Lock, RefreshCw, Save, X } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { apiClient, RolePermission } from '@/lib/api-client';
import { ALL_MENUS, ROLES } from '@/lib/menu-config';

function normalizePermissions(data: RolePermission[]) {
  return ROLES.map((role) => {
    const existing = data.find((permission) => permission.role === role);

    return {
      role,
      allowed_menus: existing?.allowed_menus || [],
      updated_at: existing?.updated_at
    };
  });
}

export default function PermissionsPage() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyPermissionsResponse = (data: RolePermission[] | RolePermission) => {
    if (Array.isArray(data)) {
      setPermissions(normalizePermissions(data));
    }
  };

  const fetchPermissions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getPermissions();
      applyPermissionsResponse(data);
    } catch (err) {
      console.error('Failed to fetch permissions:', err);
      setError('ไม่สามารถดึงข้อมูลสิทธิ์ได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const loadInitialPermissions = async () => {
      try {
        const data = await apiClient.getPermissions();
        if (!active) {
          return;
        }

        setError(null);
        applyPermissionsResponse(data);
      } catch (err) {
        if (!active) {
          return;
        }

        console.error('Failed to fetch permissions:', err);
        setError('ไม่สามารถดึงข้อมูลสิทธิ์ได้');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadInitialPermissions();

    return () => {
      active = false;
    };
  }, []);

  const togglePermission = (role: string, menuId: string) => {
    setPermissions((prev) => {
      const source = prev.length > 0 ? prev : normalizePermissions([]);

      return source.map((permission) => {
        if (permission.role !== role) {
          return permission;
        }

        const hasMenu = permission.allowed_menus.includes(menuId);
        return {
          ...permission,
          allowed_menus: hasMenu
            ? permission.allowed_menus.filter((id) => id !== menuId)
            : [...permission.allowed_menus, menuId],
        };
      });
    });
  };

  const savePermissions = async (role: string) => {
    const roleData = permissions.find((permission) => permission.role === role) || {
      role,
      allowed_menus: []
    };

    setSaving(role);
    setError(null);
    try {
      await apiClient.updatePermissions(role, roleData.allowed_menus);
      setTimeout(() => setSaving(null), 500);
    } catch (err) {
      console.error(`Failed to save permissions for ${role}:`, err);
      setError(`Unable to save permissions for ${role}`);
      alert(`ไม่สามารถบันทึกสิทธิ์สำหรับ ${role} ได้`);
      setSaving(null);
    }
  };

  if (user?.role !== 'Admin') {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Lock className="text-red-500" size={48} />
        <h1 className="text-xl font-bold">Access Denied</h1>
        <p className="text-gray-500 text-sm">เฉพาะ Admin เท่านั้นที่สามารถเข้าถึงหน้านี้ได้</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-3">
            Permissions <span className="text-gray-400 font-normal">/</span> <span className="bg-[#e7f0ff] text-[#166ee1] px-3 py-1 rounded-lg text-xl font-bold">RBAC Management</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1 font-medium">Control which menus each user role can see and access.</p>
        </div>
        <button
          onClick={fetchPermissions}
          className="flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh Matrix
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-600">
          <X size={20} />
          <p className="text-xs font-bold">{error}</p>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest min-w-[250px]">Menu Section</th>
                {ROLES.map((role) => (
                  <th key={role} className="px-6 py-5 text-center min-w-[120px]">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{role}</span>
                      <button
                        onClick={() => savePermissions(role)}
                        disabled={saving === role}
                        className={`mt-1 p-1.5 rounded-lg transition-all ${saving === role ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500 hover:bg-blue-600 hover:text-white'}`}
                        title="Save role permissions"
                      >
                        {saving === role ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ALL_MENUS.map((menu) => (
                <tr key={menu.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-8 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                        <menu.icon size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{menu.label}</p>
                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-tighter">ID: {menu.id}</p>
                      </div>
                    </div>
                  </td>
                  {ROLES.map((role) => {
                    const rolePerms = permissions.find((permission) => permission.role === role);
                    const isAllowed = rolePerms?.allowed_menus.includes(menu.id);

                    return (
                      <td key={role} className="px-6 py-4 text-center">
                        <button
                          onClick={() => togglePermission(role, menu.id)}
                          className={`
                            w-6 h-6 rounded-md border-2 transition-all flex items-center justify-center mx-auto
                            ${isAllowed
                              ? 'bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-200'
                              : 'bg-white border-gray-200 text-transparent hover:border-blue-300'}
                          `}
                        >
                          <Check size={14} strokeWidth={4} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
