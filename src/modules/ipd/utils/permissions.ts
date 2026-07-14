// IPD permission keys — stored in the SHARED profiles.permissions / roles
// tables (same RBAC as the OPD app and LIMS). Namespaced ipd_* so granting
// IPD access never collides with OPD permission strings. Admin roles and the
// 'all' / 'admin' permissions bypass all of these.

export interface IpdPermission {
  key: string;
  label: string;
  description: string;
}

export const IPD_PERMISSIONS: IpdPermission[] = [
  { key: 'ipd_census', label: 'Census & Bed Board', description: 'View ward census and bed occupancy' },
  { key: 'ipd_admissions', label: 'Admissions (ADT)', description: 'Admit, transfer, discharge; open patient files' },
  { key: 'ipd_clinical', label: 'Nursing & Medications', description: 'Vitals, notes, tasks, eMAR administration' },
  { key: 'ipd_charges', label: 'Charge Posting', description: 'Post services/procedures to the running bill' },
  { key: 'ipd_billing', label: 'Billing & Deposits', description: 'Deposits, interim/final bills, payments, refunds' },
  { key: 'ipd_collections', label: 'Daily Collections', description: 'User-wise collection report and export' },
  { key: 'ipd_documents', label: 'Documents', description: 'Discharge summaries, consents, OT notes' },
  { key: 'ipd_stores', label: 'Stores', description: 'Ward sub-stores, indents, consumption' },
  { key: 'ipd_masters', label: 'Masters', description: 'Services, wards/beds, packages, accounts, templates' },
];

export const IPD_PERMISSION_KEYS = IPD_PERMISSIONS.map((p) => p.key);

/** Route → required permission (admin bypasses) */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/ipd/census': 'ipd_census',
  '/ipd/bed-board': 'ipd_census',
  '/ipd/admissions': 'ipd_admissions',
  '/ipd/billing': 'ipd_billing',
  '/ipd/stores': 'ipd_stores',
  '/ipd/masters': 'ipd_masters',
};
