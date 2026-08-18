import { Profile } from '../types';

/**
 * Central role/permission gates.
 *
 * Access is permission-driven so that combined roles (e.g. a "nurse_reception"
 * role holding the union of both permission sets) work as pure data, without a
 * code change per role name. Role names are still honoured as a legacy fallback
 * for clinics whose seeded roles predate the `reception` permission.
 */

/** Grants front-desk access: appointments desk, doctor availability, WhatsApp/AI settings. */
export const RECEPTION_PERMISSION = 'reception';

/** Anything with a denormalized role name + permission list (i.e. the signed-in profile). */
type UserLike = Pick<Profile, 'roleName' | 'permissions'> | null | undefined;

const roleOf = (user: UserLike) => user?.roleName?.toLowerCase() ?? '';
const permsOf = (user: UserLike) => user?.permissions ?? [];

/** Clinic admin or platform super admin, by role name or by wildcard permission. */
export const isAdminUser = (user: UserLike): boolean =>
  Boolean(user) && (
    roleOf(user) === 'admin' ||
    roleOf(user) === 'super_admin' ||
    permsOf(user).includes('admin') ||
    permsOf(user).includes('all')
  );

/**
 * Front-desk access. Admins always qualify. Otherwise the `reception`
 * permission decides, so a role named anything ("nurse_reception",
 * "front_office") gets in as long as it carries the permission.
 */
export const hasReceptionAccess = (user: UserLike): boolean =>
  isAdminUser(user) ||
  permsOf(user).includes(RECEPTION_PERMISSION) ||
  // Legacy: roles seeded before the `reception` permission existed.
  roleOf(user) === 'receptionist' ||
  roleOf(user) === 'reception';

/** True when the user holds `perm` (or a wildcard/admin grant). */
export const hasModulePermission = (user: UserLike, perm: string): boolean =>
  isAdminUser(user) || permsOf(user).includes(perm);
