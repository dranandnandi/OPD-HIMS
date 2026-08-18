import { IPD_PERMISSIONS } from '../modules/ipd/utils/permissions';
import { Profile } from '../types';

/**
 * Role-wise module (tab) access for the OPD app.
 *
 * Historically the OPD sidebar was open to every signed-in user: only clinic
 * tier and a handful of admin-only *configuration* routes were gated, so a
 * nurse saw the same tabs as a receptionist (including OPD Billing). IPD, which
 * arrived from a standalone app, used the opposite model — hide the tab unless
 * the user holds the permission. These keys unify the two on the IPD model:
 * every operational tab is a module the role must be granted.
 *
 * Configuration screens (clinic settings, user management, master data, system
 * settings, presets, templates) keep their existing AdminRoute gate — they were
 * already role-restricted and are not part of the day-to-day tab surface.
 *
 * LEGACY SAFETY: see `hasModuleAccess`. Roles seeded before these keys existed
 * carry none of them, and must not lose the whole app on deploy.
 */

export interface ModulePermission {
  key: string;
  label: string;
  description: string;
  /** Sidebar group the module belongs to — also used to lay out the role editor. */
  group: string;
}

/** OPD-side modules, one per sidebar tab. */
export const OPD_PERMISSIONS: ModulePermission[] = [
  { key: 'opd_appointments', label: 'Appointments', description: 'Appointment calendar & scheduling', group: 'Front Desk' },
  { key: 'opd_patients', label: 'Patients', description: 'Patient records, timeline & case upload', group: 'Front Desk' },
  { key: 'opd_visits', label: 'Visits', description: 'Visit list, EMR & prescriptions', group: 'OPD' },
  { key: 'opd_followups', label: 'Follow-ups', description: 'Follow-up tracking worklist', group: 'OPD' },
  { key: 'opd_billing', label: 'OPD Billing', description: 'Bills & payments (edit/refund still need billing rights)', group: 'Billing' },
  { key: 'opd_collections', label: 'Daily Collection', description: 'Daily payment reconciliation report', group: 'Billing' },
  { key: 'pharmacy', label: 'Pharmacy', description: 'Inventory, inward stock, suppliers, invoice upload', group: 'Pharmacy' },
  { key: 'gmb_reviews', label: 'GMB Review Requests', description: 'Send Google review requests to patients', group: 'Growth & AI' },
  { key: 'chatbots', label: 'Chatbots', description: 'Chatbot utility', group: 'Growth & AI' },
  { key: 'analytics', label: 'Analytics', description: 'Reports & insights across the clinic', group: 'General' },
];

export const OPD_PERMISSION_KEYS = OPD_PERMISSIONS.map((p) => p.key);

/** IPD modules, re-exported so the role editor renders one combined matrix. */
export const IPD_MODULE_PERMISSIONS: ModulePermission[] = IPD_PERMISSIONS.map((p) => ({
  ...p,
  group: 'IPD',
}));

/** Everything a role can be granted, in sidebar order. */
export const ALL_MODULE_PERMISSIONS: ModulePermission[] = [
  ...OPD_PERMISSIONS,
  ...IPD_MODULE_PERMISSIONS,
];

export const ALL_MODULE_PERMISSION_KEYS = ALL_MODULE_PERMISSIONS.map((p) => p.key);

/** Grouped for rendering: [['Front Desk', [...]], ['OPD', [...]], ...] */
export const MODULE_PERMISSION_GROUPS: Array<[string, ModulePermission[]]> =
  ALL_MODULE_PERMISSIONS.reduce((acc, perm) => {
    const existing = acc.find(([group]) => group === perm.group);
    if (existing) existing[1].push(perm);
    else acc.push([perm.group, [perm]]);
    return acc;
  }, [] as Array<[string, ModulePermission[]]>);

type UserLike = Pick<Profile, 'roleName' | 'permissions'> | null | undefined;
type UserWithClinic = (UserLike & Pick<Profile, 'clinic'>) | null | undefined;

const permsOf = (user: UserLike) => user?.permissions ?? [];

const isAdmin = (user: UserLike): boolean => {
  const role = user?.roleName?.toLowerCase() ?? '';
  const perms = permsOf(user);
  return role === 'admin' || role === 'super_admin' ||
    perms.includes('admin') || perms.includes('all');
};

/**
 * Written onto a role whenever an admin saves its module matrix.
 *
 * Without it, "no modules ticked" is indistinguishable from "never configured",
 * so an admin who unticks everything to lock a role down would instead reopen
 * the entire OPD sidebar. The marker records that the empty set is deliberate.
 */
export const MODULE_ASSIGNMENT_MARKER = 'modules_assigned';

/**
 * True when a role predates module permissions — never configured, and holding
 * none of the OPD keys.
 *
 * Such roles fall back to the old "every OPD tab is visible" behaviour so that
 * deploying this change does not black out existing staff before an admin has
 * assigned modules. Enforcement switches on for a role the moment it is granted
 * an OPD module or its matrix is saved. IPD deliberately does NOT get this
 * fallback: it was always permission-gated, so an unmigrated role keeps seeing
 * nothing there.
 */
export const isLegacyRole = (user: UserLike): boolean => {
  const perms = permsOf(user);
  if (perms.includes(MODULE_ASSIGNMENT_MARKER)) return false;
  return !perms.some((p) => OPD_PERMISSION_KEYS.includes(p));
};

/**
 * The single gate for module/tab access. Admins and `all` bypass.
 *
 * Used by the sidebar, the mobile menu and the route guards so a hidden tab is
 * genuinely unreachable rather than merely unlisted.
 */
export const hasModuleAccess = (user: UserLike, perm: string): boolean => {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (permsOf(user).includes(perm)) return true;
  // Unmigrated role: keep the old open-access behaviour for OPD tabs only.
  if (OPD_PERMISSION_KEYS.includes(perm)) return isLegacyRole(user);
  return false;
};

/**
 * Where to send a user who has no access to the page they landed on.
 *
 * With tabs now role-scoped, "/" is no longer a safe universal fallback: a
 * pharmacist without `opd_appointments` would bounce between "/" and the guard
 * forever. Resolves to the first module the user actually holds, and finally to
 * /settings, which every signed-in user can open (it hosts their own profile).
 */
const LANDING_ORDER: Array<[string, string]> = [
  ['opd_appointments', '/'],
  ['opd_patients', '/patients'],
  ['opd_visits', '/visits'],
  ['ipd_census', '/ipd/census'],
  ['ipd_admissions', '/ipd/admissions/new'],
  ['ipd_clinical', '/ipd/census'],
  ['opd_billing', '/billing'],
  ['ipd_billing', '/ipd/billing'],
  ['pharmacy', '/pharmacy'],
  ['analytics', '/analytics'],
];

export const resolveLandingPath = (user: UserWithClinic): string => {
  const ipdEnabled = user?.clinic?.ipdEnabled ?? false;
  const match = LANDING_ORDER.find(([perm, path]) => {
    if (path.startsWith('/ipd') && !ipdEnabled) return false;
    return hasModuleAccess(user, perm);
  });
  return match ? match[1] : '/settings';
};
