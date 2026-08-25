import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Droplets, Pill, Stethoscope, Info, Activity } from 'lucide-react';
import { treatmentPlanService } from '../../services/treatmentPlanService';
import {
  medicationService, FREQUENCY_OPTIONS, isScheduledFrequency, orderDoseTimes, formatDoseTime,
} from '../../services/medicationService';
import { monitoringService, intervalLabel, VITAL_FIELD_OPTIONS } from '../../services/monitoringService';
import type { MedicationOrder, MonitoringOrder, TreatmentPlan } from '../../types/ipd';

interface Props {
  admissionId: string;
}

/**
 * What the doctor has ordered, as the ward needs to read it — strictly view
 * only.
 *
 * The Treatment Plan tab is the doctor's ('ipd_treatment_plan'), so nursing
 * could not see the round notes at all, including the field literally labelled
 * "Advice / instructions to ward staff". Medicines were only visible in the
 * eMAR, and anything written as prose — "TPR/BP 4 hourly", "watch urine
 * output", "continue IV antibiotics" — reached nobody. This panel surfaces
 * both, without granting any write access to either.
 */
export default function DoctorOrdersSection({ admissionId }: Props) {
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [orders, setOrders] = useState<MedicationOrder[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringOrder[]>([]);
  const [showAllPlans, setShowAllPlans] = useState(false);

  const reload = useCallback(() => {
    Promise.all([
      treatmentPlanService.list(admissionId),
      medicationService.listOrders(admissionId),
      monitoringService.listOrders(admissionId),
    ])
      .then(([p, o, m]) => {
        setPlans(p);
        setOrders(o);
        setMonitoring(m);
      })
      .catch((e) => toast.error(e.message));
  }, [admissionId]);

  useEffect(reload, [reload]);

  // Standing orders only: what is running right now, IV first because those are
  // the ones that need watching.
  const standing = useMemo(() => {
    const live = orders.filter((o) => o.status === 'active' || o.status === 'held');
    const rank = (o: MedicationOrder) => (o.route === 'iv' ? 0 : 1);
    return [...live].sort((a, b) => rank(a) - rank(b));
  }, [orders]);

  const activeMonitoring = useMemo(
    () => monitoring.filter((m) => m.status === 'active'),
    [monitoring]
  );

  const visiblePlans = showAllPlans ? plans : plans.slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <Info className="w-4 h-4 shrink-0 mt-px" />
        <span>
          Read only — written by the treating doctor. Sign for each dose in the{' '}
          <b>Meds</b> tab (eMAR), and chart what you observe under{' '}
          <b>Vitals</b>, <b>Notes</b> and <b>Tasks</b>.
        </span>
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-2">
          <Pill className="w-4 h-4 text-navy-600" />
          Medicines &amp; IV fluids ({standing.length} running)
        </h3>

        {standing.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">
            No medication order is running. IV fluids appear here once they are ordered
            with route <b>IV</b>.
          </p>
        ) : (
          <div className="space-y-1.5">
            {standing.map((o) => {
              const iv = o.route === 'iv';
              const held = o.status === 'held';
              return (
                <div
                  key={o.id}
                  className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                    held
                      ? 'border-slate-200 bg-slate-50 text-slate-400'
                      : iv
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-slate-200'
                  }`}
                >
                  {iv
                    ? <Droplets className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    : <Pill className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <p className={held ? '' : 'font-medium text-slate-800'}>
                      {o.medicine_name}
                      {o.dose && <span className="ml-1.5 text-slate-600">{o.dose}</span>}
                      {o.route && (
                        <span
                          className={`ml-1.5 text-xs uppercase px-1.5 py-0.5 rounded ${
                            iv ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {o.route.replace(/_/g, ' ')}
                        </span>
                      )}
                      <span className="ml-1.5 text-xs text-slate-500">
                        {frequencyLabel(o.frequency_code)}
                        {isScheduledFrequency(o.frequency_code) &&
                          ` — at ${orderDoseTimes(o).map(formatDoseTime).join(', ')}`}
                      </span>
                      {held && (
                        <span className="ml-1.5 text-xs uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          on hold
                        </span>
                      )}
                    </p>
                    {o.instructions && (
                      <p className="text-xs text-slate-500 mt-0.5">{o.instructions}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">
                      From {format(new Date(o.start_at), 'dd MMM, HH:mm')}
                      {o.end_at && ` · till ${format(new Date(o.end_at), 'dd MMM')}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-2">
          <Activity className="w-4 h-4 text-navy-600" />
          Monitoring &amp; observations ({activeMonitoring.length} running)
        </h3>

        {activeMonitoring.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">
            Nothing is being charted on a schedule. Standing observations &mdash; &ldquo;TPR, BP
            every 30 min&rdquo;, &ldquo;watch for abdominal distension&rdquo; &mdash; are ordered
            under <b>Vitals</b> and appear here once running.
          </p>
        ) : (
          <div className="space-y-1.5">
            {activeMonitoring.map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-sm">
                <Activity className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">
                    {m.title}
                    <span className="ml-1.5 text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                      {intervalLabel(m.interval_minutes)}
                    </span>
                  </p>
                  {m.kind === 'vitals' && m.fields.length > 0 && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Chart: {m.fields.map((f) => VITAL_FIELD_OPTIONS.find((v) => v.key === f)?.label ?? f).join(', ')}
                    </p>
                  )}
                  {m.instructions && <p className="text-xs text-slate-500 mt-0.5">{m.instructions}</p>}
                  <p className="text-xs text-slate-400 mt-0.5">
                    From {format(new Date(m.start_at), 'dd MMM, HH:mm')}
                    {m.end_at && ` · till ${format(new Date(m.end_at), 'dd MMM, HH:mm')}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-2">
          <Stethoscope className="w-4 h-4 text-navy-600" />
          Doctor&rsquo;s notes &amp; instructions
        </h3>

        {plans.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">
            The doctor has not written a round note for this admission yet.
          </p>
        ) : (
          <div className="space-y-2">
            {visiblePlans.map((p) => (
              <div key={p.id} className="border border-slate-200 rounded-lg p-2.5">
                <p className="text-xs text-slate-400 mb-1">
                  {format(new Date(p.plan_date), 'dd MMM yyyy')}
                  {p.doctor?.name && ` · Dr ${p.doctor.name}`}
                  {p.status === 'superseded' && ' · superseded'}
                </p>
                {PLAN_FIELDS.map(([key, label]) =>
                  p[key] ? (
                    <div key={key} className="mb-1.5 last:mb-0">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        {label}
                      </span>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{p[key]}</p>
                    </div>
                  ) : null
                )}
              </div>
            ))}
            {plans.length > visiblePlans.length && (
              <button
                onClick={() => setShowAllPlans(true)}
                className="text-sm text-navy-700 hover:underline"
              >
                Show all {plans.length} entries
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Order matters — this is the order the ward reads a round note in. */
const PLAN_FIELDS: Array<[keyof TreatmentPlan & ('plan' | 'advice' | 'assessment' | 'objective'), string]> = [
  ['plan', "Today's plan"],
  ['advice', 'Advice / instructions to ward staff'],
  ['assessment', 'Assessment'],
  ['objective', 'Examination'],
];

const frequencyLabel = (code: string): string =>
  FREQUENCY_OPTIONS.find((f) => f.code === code)?.label ?? code.toUpperCase();
