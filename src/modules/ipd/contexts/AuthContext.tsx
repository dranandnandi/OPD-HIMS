// Shim: adapts the OPD app's auth context to the shape the IPD module expects.
// IPD components/pages only consume { profile, clinicId, isAdmin, hasPermission },
// and `profile` is only read for its `id`. Keeping this file at the original
// relative path means the IPD sources run unmodified inside the OPD app.
import { useAuth as useOpdAuth } from '../../../components/Auth/useAuth';
import type { Profile as IpdProfile } from '../types/ipd';

interface IpdAuthValue {
  profile: IpdProfile | null;
  clinicId: string | null;
  /** admin/super_admin role or 'admin'/'all' permission */
  isAdmin: boolean;
  /** IPD RBAC check against shared profiles.permissions; admin bypasses */
  hasPermission: (permission: string) => boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

export function useAuth(): IpdAuthValue {
  const { user, loading, signOut } = useOpdAuth();

  const roleName = user?.roleName?.toLowerCase() ?? '';
  const perms = user?.permissions ?? [];
  const isAdmin =
    roleName === 'admin' || roleName === 'super_admin' ||
    perms.includes('admin') || perms.includes('all');

  const hasPermission = (permission: string) =>
    isAdmin || perms.includes(permission) || perms.includes('all');

  const profile: IpdProfile | null = user
    ? {
      id: user.id,
      clinic_id: user.clinicId ?? null,
      name: user.name ?? null,
      email: user.email ?? '',
      role_name: user.roleName ?? null,
      specialization: user.specialization ?? null,
      permissions: perms,
      is_active: user.isActive ?? null,
    }
    : null;

  return {
    profile,
    clinicId: user?.clinicId ?? null,
    isAdmin,
    hasPermission,
    loading,
    signOut,
  };
}
