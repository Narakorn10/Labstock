'use client';

import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Save,
  RefreshCw,
  Check,
  X,
  Lock,
  Eye,
  Settings,
  Database,
  Users,
  ShoppingCart,
  Activity,
  Box
} from 'lucide-react';
import { apiClient, RolePermission } from '@/lib/api-client';
import { useAuth } from '@/components/auth-provider';
import { ADMIN_LOCKED_MENUS, isLockedMenu } from '@/lib/admin-locked-menus';

const ALL_MENUS = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'analysis', label: 'Analysis', icon: Eye },
  { id: 'logs', label: 'History Logs', icon: Database },
  { id: 'dispense', label: 'Dispense', icon: Box },
  { id: 'receive', label: 'Receive Stock', icon: Box },
  { id: 'count', label: 'Stock Count', icon: Check },
  { id: 'borrow', label: 'Borrow System', icon: RefreshCw },
  { id: 'lend', label: 'Lend System', icon: RefreshCw },
  { id: 'orders', label: 'Purchase Orders', icon: ShoppingCart },
  { id: 'receive_vendor', label: 'Receive from Vendor', icon: Box },
  { id: 'vendor_orders', label: 'Vendor PO Portal', icon: ShoppingCart },
  { id: 'vendor_shipments', label: 'Vendor Shipments', icon: Box },
  { id: 'master_data', label: 'Master Data', icon: Database },
  { id: 'main_stock', label: 'Main Stock', icon: Database },
  { id: 'user_management', label: 'User Management', icon: Users },
  { id: 'settings', label: 'System Settings', icon: Settings },
  { id: 'notifications', label: 'Notifications', icon: Settings },
  { id: 'barcodes', label: 'Barcode Learning', icon: Settings },
  { id: 'reagent_order_policies', label: 'ตั้งค่านโยบายสั่งซื้อน้ำยา', icon: Settings },
  { id: 'rbac', label: 'Permissions Management', icon: ShieldCheck }
];

const ROLES = ['Admin', 'Manager', 'Operator', 'User', 'Vendor'];

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
  const { user, loading: authLoading } = useAuth();
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
      setError('Unable to load permission data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const loadInitialPermissions = async () => {
      if (authLoading) {
        return;
      }

      if (!user || user.role !== 'Admin') {
        return;
      }

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
        setError('Unable to load permission data');
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
  }, [authLoading, user]);

  if (authLoading || (user?.role === 'Admin' && loading)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <RefreshCw className="animate-spin text-blue-600" size={48} />
        <p className="text-gray-500 text-sm">Loading permissions...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const togglePermission = (role: string, menuId: string) => {
    if (isLockedMenu(role, menuId)) return;
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
            : [...permission.allowed_menus, menuId]
        };
      });
    });
  };

  const savePermissions = async (role: string) => {
    const roleData = permissions.find((permission) => permission.role === role) || {
      role,
      allowed_menus: []
    };
    // Locked menus are always saved for Admin (also repairs a role that already lost them).
    const menusToSave = role === 'Admin'
      ? Array.from(new Set([...roleData.allowed_menus, ...ADMIN_LOCKED_MENUS]))
      : roleData.allowed_menus;

    setSaving(role);
    setError(null);
    try {
      await apiClient.updatePermissions(role, menusToSave);
      setTimeout(() => setSaving(null), 500);
    } catch (err) {
      console.error(`Failed to save permissions for ${role}:`, err);
      setError(`Unable to save permissions for ${role}`);
      alert(`Unable to save permissions for ${role}`);
      setSaving(null);
    }
  };

  if (user?.role !== 'Admin') {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Lock className="text-red-500" size={48} />
        <h1 className="text-xl font-bold">Access Denied</h1>
        <p className="mt-1 text-sm text-ink-muted">Only Admin can open this page.</p>
      </div>
    );
  }

  const headClass = 'bg-ground px-3.5 py-2.5 text-left text-[13px] font-medium text-gray-600';
  const cellClass = 'border-b border-line px-3.5 py-3 align-middle text-sm';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-500 pb-20">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[32px] leading-tight font-medium text-ink">Permissions (RBAC)</h1>
          <p className="mt-1.5 text-[15px] text-gray-600">ติ๊กเมนูที่แต่ละบทบาทเข้าถึงได้ แล้วกดบันทึกที่หัวคอลัมน์ของบทบาทนั้น</p>
        </div>
        <button
          type="button"
          onClick={fetchPermissions}
          className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink transition hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          โหลดข้อมูลใหม่
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-xl bg-crit-bg px-3.5 py-3 text-sm font-medium text-crit">
          <X size={16} />
          <p>{error}</p>
        </div>
      )}

      <section aria-label="ตารางสิทธิ์เมนูตามบทบาท" className="rounded-2xl border border-line bg-white p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
            <caption className="sr-only">สิทธิ์การเข้าถึงเมนูของแต่ละบทบาท</caption>
            <thead>
              <tr>
                <th scope="col" className={`${headClass} min-w-[250px] rounded-l-[10px]`}>Menu Section</th>
                {ROLES.map((role, index) => (
                  <th key={role} scope="col" className={`${headClass} text-center ${index === ROLES.length - 1 ? 'rounded-r-[10px]' : ''}`}>
                    <div className="flex items-center justify-center gap-2">
                      <span>{role}</span>
                      <button
                        type="button"
                        onClick={() => savePermissions(role)}
                        disabled={saving === role}
                        className={`inline-flex items-center rounded-[8px] border p-1.5 transition disabled:cursor-wait ${saving === role ? 'border-line bg-gray-200 text-ink' : 'border-line bg-white text-gray-700 hover:border-ink hover:bg-ink hover:text-white'}`}
                        title="บันทึกสิทธิ์ของบทบาทนี้"
                        aria-label={`บันทึกสิทธิ์ของ ${role}`}
                      >
                        {saving === role ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_MENUS.map((menu) => (
                <tr key={menu.id}>
                  <th scope="row" className={`${cellClass} font-normal`}>
                    <span className="flex items-center gap-2">
                      <menu.icon size={16} aria-hidden="true" className="shrink-0 text-gray-700" />
                      <span>
                        <span className="block font-medium">{menu.label}</span>
                        <span className="block text-xs text-gray-600">ID: {menu.id}</span>
                      </span>
                    </span>
                  </th>
                  {ROLES.map((role) => {
                    const rolePerms = permissions.find((permission) => permission.role === role);
                    const locked = isLockedMenu(role, menu.id);
                    const isAllowed = locked || !!rolePerms?.allowed_menus.includes(menu.id);

                    return (
                      <td key={role} className={`${cellClass} text-center`}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isAllowed}
                          aria-label={`${role} เข้าถึง ${menu.label}${locked ? ' (ล็อก)' : ''}`}
                          aria-disabled={locked}
                          title={locked ? 'ล็อกไว้เพื่อป้องกันการล็อกตัวเองออกจากระบบ' : undefined}
                          onClick={() => togglePermission(role, menu.id)}
                          className={`mx-auto inline-grid size-[22px] place-items-center rounded-md transition ${isAllowed
                            ? 'bg-ink text-white'
                            : 'border-[1.5px] border-gray-400 text-transparent hover:border-ink'} ${locked ? 'cursor-not-allowed opacity-45' : ''}`}
                        >
                          <Check size={14} strokeWidth={3} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-600">การเปลี่ยนแปลงจะมีผลเมื่อกดปุ่มบันทึกของบทบาทนั้น · Inventory Overview และ Permissions ของ Admin ล็อกไว้เพื่อป้องกันการล็อกตัวเองออกจากระบบ</p>
      </section>
    </div>
  );
}
