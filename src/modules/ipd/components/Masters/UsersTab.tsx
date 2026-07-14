import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck, UserRound } from 'lucide-react';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { IPD_PERMISSIONS, IPD_PERMISSION_KEYS } from '../../utils/permissions';

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role_name: string | null;
  permissions: string[];
  is_active: boolean | null;
}

interface Props {
  clinicId: string;
}

/**
 * Grants ipd_* permissions per user, writing to the SHARED
 * profiles.permissions array (same RBAC the OPD app manages roles with).
 * Non-IPD permission strings are preserved untouched. Users and roles are
 * still created in the OPD app's User Management.
 */
export default function UsersTab({ clinicId }: Props) {
  const { profile: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    supabase
      .from('profiles')
      .select('id, name, email, role_name, permissions, is_active')
      .eq('clinic_id', clinicId)
      .order('name')
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        else setUsers((data as UserRow[]) ?? []);
      });
  }, [clinicId]);

  useEffect(reload, [reload]);

  const isUserAdmin = (u: UserRow) => {
    const role = u.role_name?.toLowerCase() ?? '';
    return role === 'admin' || role === 'super_admin' ||
      u.permissions.includes('admin') || u.permissions.includes('all');
  };

  const setPermissions = async (u: UserRow, nextIpdPerms: string[]) => {
    const others = u.permissions.filter((p) => !IPD_PERMISSION_KEYS.includes(p));
    const next = [...others, ...nextIpdPerms];
    setSavingId(u.id);
    // optimistic update so checkboxes feel instant
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, permissions: next } : x)));
    const { error } = await supabase
      .from('profiles')
      .update({ permissions: next, updated_at: new Date().toISOString() })
      .eq('id', u.id);
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      reload(); // roll back to server truth
    }
  };

  const toggle = (u: UserRow, key: string) => {
    const current = u.permissions.filter((p) => IPD_PERMISSION_KEYS.includes(p));
    void setPermissions(
      u,
      current.includes(key) ? current.filter((p) => p !== key) : [...current, key]
    );
  };

  const grantAll = (u: UserRow, on: boolean) => {
    void setPermissions(u, on ? [...IPD_PERMISSION_KEYS] : []);
  };

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 text-xs text-slate-500">
        Users and roles are managed in the OPD app (Settings → User Management) — this screen
        only grants <b>IPD module access</b> per user. Admin roles bypass all checks. Changes
        apply on the user's next sign-in or page refresh.
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5">User</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-3 py-2.5 text-center">All IPD</th>
              {IPD_PERMISSIONS.map((p) => (
                <th key={p.key} className="px-3 py-2.5 text-center whitespace-nowrap" title={p.description}>
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const admin = isUserAdmin(u);
              const granted = u.permissions.filter((p) => IPD_PERMISSION_KEYS.includes(p));
              return (
                <tr key={u.id} className={`border-b border-slate-100 ${u.is_active === false ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 font-medium text-slate-700">
                      <UserRound className="w-4 h-4 text-slate-400 shrink-0" />
                      {u.name ?? u.email}
                      {u.id === me?.id && <span className="text-xs text-slate-400">(you)</span>}
                    </span>
                    <span className="block text-xs text-slate-400 ml-6">{u.email}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 capitalize">
                    {u.role_name?.replace(/_/g, ' ') ?? '—'}
                    {admin && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">
                        <ShieldCheck className="w-3 h-3" /> full access
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      disabled={admin || savingId === u.id}
                      checked={admin || granted.length === IPD_PERMISSION_KEYS.length}
                      onChange={(e) => grantAll(u, e.target.checked)}
                    />
                  </td>
                  {IPD_PERMISSIONS.map((p) => (
                    <td key={p.key} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        disabled={admin || savingId === u.id}
                        checked={admin || granted.includes(p.key)}
                        onChange={() => toggle(u, p.key)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={IPD_PERMISSIONS.length + 3} className="px-4 py-8 text-center text-slate-400">
                  No users found for this clinic.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
