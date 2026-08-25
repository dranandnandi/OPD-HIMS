import { supabase } from '../utils/supabase';

/**
 * What is pending or has been missed right now, across the ward.
 *
 * Everything overdue used to be buried one tab down inside one patient's chart:
 * a dose due at 8 PM and an hourly TPR both looked identical to nothing at all
 * until somebody opened that admission and scrolled. This is the single query
 * behind the always-visible alert bar — one read for medications, one for
 * nursing/monitoring occurrences, merged and ranked.
 */

export type AlertSeverity = 'missed' | 'due' | 'soon';
export type AlertKind = 'medication' | 'monitoring' | 'observation' | 'task';

export interface IpdAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  /** what has to happen — 'Inj. Monosef 1 g IV' / 'TPR + BP — chart Temp, Pulse…' */
  title: string;
  detail?: string;
  dueAt: string;
  /** minutes late (negative when still upcoming) */
  minutesLate: number;
  admissionId: string;
  admissionNumber: string;
  patientName: string;
  bedLabel: string | null;
  /** tab to land on when the alert is clicked */
  tab: 'meds' | 'nursing';
}

/** How far ahead an upcoming item is worth showing. */
const LOOKAHEAD_MINUTES = 45;

const severityRank: Record<AlertSeverity, number> = { missed: 0, due: 1, soon: 2 };

function classify(dueAt: Date, graceMinutes: number, now: Date): { severity: AlertSeverity; minutesLate: number } {
  const minutesLate = Math.round((now.getTime() - dueAt.getTime()) / 60000);
  if (minutesLate > graceMinutes) return { severity: 'missed', minutesLate };
  if (minutesLate >= 0) return { severity: 'due', minutesLate };
  return { severity: 'soon', minutesLate };
}

/** The admission context PostgREST embeds on every alert row. */
interface AlertAdmission {
  id: string;
  admission_number: string | null;
  status: string;
  patient: { name: string | null } | null;
  current_bed: { bed_number: string; ward: { name: string } | null } | null;
}

interface MedRow {
  id: string;
  scheduled_at: string;
  admission_id: string;
  medication_order: {
    medicine_name: string;
    dose: string | null;
    route: string | null;
    grace_minutes: number | null;
    status: string;
  } | null;
  admission: AlertAdmission | null;
}

interface TaskRow {
  id: string;
  task: string;
  due_at: string;
  category: string | null;
  grace_minutes: number | null;
  monitoring_order_id: string | null;
  admission_id: string;
  admission: AlertAdmission | null;
}

function bedLabelOf(admission: AlertAdmission | null): string | null {
  const bed = admission?.current_bed;
  if (!bed) return null;
  return bed.ward?.name ? `${bed.ward.name} · ${bed.bed_number}` : bed.bed_number;
}

/** Admission columns every alert needs, joined inner so discharged beds drop out. */
const ADMISSION_JOIN =
  `admission:ipd_admissions!inner(id, admission_number, status,
     patient:patients(name),
     current_bed:ipd_beds(bed_number, ward:ipd_wards(name)))`;

export const alertService = {
  /**
   * Pending + missed work for the whole clinic, or for one admission.
   * Only live admissions are considered — a discharged chart cannot be overdue.
   */
  async list(params: { clinicId: string; admissionId?: string }): Promise<IpdAlert[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60 * 1000).toISOString();

    let medQuery = supabase
      .from('ipd_medication_schedule')
      .select(
        `id, scheduled_at, status, admission_id,
         medication_order:ipd_medication_orders(medicine_name, dose, route, grace_minutes, status),
         ${ADMISSION_JOIN}`
      )
      .eq('clinic_id', params.clinicId)
      .eq('status', 'due')
      .eq('admission.status', 'admitted')
      .lte('scheduled_at', horizon)
      .order('scheduled_at', { ascending: true })
      .limit(300);

    let taskQuery = supabase
      .from('ipd_nursing_tasks')
      .select(
        `id, task, due_at, status, category, grace_minutes, monitoring_order_id, admission_id,
         ${ADMISSION_JOIN}`
      )
      .eq('clinic_id', params.clinicId)
      .eq('status', 'pending')
      .eq('admission.status', 'admitted')
      .not('due_at', 'is', null)
      .lte('due_at', horizon)
      .order('due_at', { ascending: true })
      .limit(300);

    if (params.admissionId) {
      medQuery = medQuery.eq('admission_id', params.admissionId);
      taskQuery = taskQuery.eq('admission_id', params.admissionId);
    }

    const [medRes, taskRes] = await Promise.all([medQuery, taskQuery]);
    if (medRes.error) throw medRes.error;
    if (taskRes.error) throw taskRes.error;

    const alerts: IpdAlert[] = [];

    for (const row of (medRes.data ?? []) as unknown as MedRow[]) {
      const order = row.medication_order;
      // a dose whose order was stopped is not owed any more
      if (!order || order.status === 'stopped') continue;
      const dueAt = new Date(row.scheduled_at);
      const { severity, minutesLate } = classify(dueAt, order.grace_minutes ?? 30, now);
      alerts.push({
        id: `med:${row.id}`,
        kind: 'medication',
        severity,
        title: [order.medicine_name, order.dose].filter(Boolean).join(' '),
        detail: order.route ? order.route.replace(/_/g, ' ').toUpperCase() : undefined,
        dueAt: row.scheduled_at,
        minutesLate,
        admissionId: row.admission_id,
        admissionNumber: row.admission?.admission_number ?? '',
        patientName: row.admission?.patient?.name ?? 'Patient',
        bedLabel: bedLabelOf(row.admission),
        tab: 'meds',
      });
    }

    for (const row of (taskRes.data ?? []) as unknown as TaskRow[]) {
      const dueAt = new Date(row.due_at);
      const { severity, minutesLate } = classify(dueAt, row.grace_minutes ?? 15, now);
      const kind: AlertKind =
        row.category === 'monitoring' || row.category === 'intake_output' ? 'monitoring'
          : row.category === 'observation' ? 'observation'
            : 'task';
      alerts.push({
        id: `task:${row.id}`,
        kind,
        severity,
        title: row.task,
        dueAt: row.due_at,
        minutesLate,
        admissionId: row.admission_id,
        admissionNumber: row.admission?.admission_number ?? '',
        patientName: row.admission?.patient?.name ?? 'Patient',
        bedLabel: bedLabelOf(row.admission),
        tab: 'nursing',
      });
    }

    return alerts.sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    );
  },
};

export function summarise(alerts: IpdAlert[]): Record<AlertSeverity, number> {
  return alerts.reduce(
    (acc, a) => ({ ...acc, [a.severity]: acc[a.severity] + 1 }),
    { missed: 0, due: 0, soon: 0 } as Record<AlertSeverity, number>
  );
}

/** '25 min late' / 'due now' / 'in 10 min' */
export function lateLabel(alert: IpdAlert): string {
  const m = alert.minutesLate;
  if (m < 0) {
    const mins = Math.abs(m);
    return mins >= 60 ? `in ${Math.round(mins / 60)} h` : `in ${mins} min`;
  }
  if (m === 0) return 'due now';
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h} h ${rem} min late` : `${h} h late`;
  }
  return `${m} min late`;
}
