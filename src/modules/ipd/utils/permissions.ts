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
  { key: 'ipd_vitals_amend', label: 'Amend Charted Entries', description: 'Correct or strike an already-charted vitals round, intake/output entry or nursing note — every change needs a reason and is kept in the correction trail. Nobody holds this by default; admins have it through their role' },
  { key: 'ipd_treatment_plan', label: 'Treatment Plan', description: 'Plan of care — doctors only; nursing staff chart under Nursing & Medications' },
  { key: 'ipd_charges', label: 'Charge Posting', description: 'Post services/procedures to the running bill' },
  { key: 'ipd_billing', label: 'Billing & Deposits', description: 'Deposits, interim/final bills, payments, refunds' },
  { key: 'ipd_collections', label: 'Daily Collections', description: 'User-wise collection report and export' },
  { key: 'ipd_documents', label: 'Documents', description: 'See and print every document; write consents, admission sheets, DAMA forms, estimates' },
  { key: 'ipd_documents_nursing', label: 'Nursing Sheet (author)', description: 'Write the nursing sheet — nursing staff; doctors hold this through Clinical Documents' },
  { key: 'ipd_documents_clinical', label: 'Clinical Documents (author)', description: 'Write and sign the doctor assessment, case sheet, OT notes, discharge/death summaries, referral letters — doctors only' },
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

/**
 * May this user chart on the ward — vitals, intake/output, nursing notes?
 * Nursing staff hold 'ipd_clinical'; a doctor charting on a round may hold
 * only 'ipd_treatment_plan', and the voice dictation path writes vitals for
 * both. Mirrors public.ipd_can_chart() in the database, which is what actually
 * enforces it (20260902000000_ipd_chart_integrity.sql).
 */
export const canChartIpd = (has: (perm: string) => boolean): boolean =>
  has('ipd_clinical') || has('ipd_treatment_plan');

/**
 * May this user correct something already charted? Distinct from charting it
 * in the first place: an amendment rewrites a clinical record, so it needs its
 * own key, a reason, and leaves a row in ipd_chart_amendments.
 */
export const canAmendChart = (has: (perm: string) => boolean): boolean =>
  has('ipd_vitals_amend');
