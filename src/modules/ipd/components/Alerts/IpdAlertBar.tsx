import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  AlertTriangle, BellRing, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock,
  Eye, HeartPulse, Pill, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { alertService, lateLabel, summarise, IpdAlert, AlertSeverity } from '../../services/alertService';
import { ALERTS_CHANGED_EVENT } from '../../services/alertBus';

/**
 * The always-on ward alert bar.
 *
 * Sits above every IPD page and answers one question without anyone having to
 * go looking: is anything overdue right now? A dose due at 8 PM, a 30-minute
 * TPR, a 4-hourly abdominal check — all of it used to be invisible until
 * somebody opened that patient's chart and scrolled to the right tab.
 *
 * It stays on screen even when everything is clear, because a bar that only
 * appears when something is wrong is a bar nobody trusts is working.
 */

/** How often the bar re-reads the ward. */
const POLL_MS = 30_000;

interface Props {
  /** limit the bar to one admission (the chart currently open) */
  admissionId?: string;
}

export default function IpdAlertBar({ admissionId }: Props) {
  const { clinicId, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<IpdAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // which patients the user has opened — the bar never opens a patient for them,
  // otherwise a ward with thirty overdue items becomes an unreadable wall
  const [openPatients, setOpenPatients] = useState<Set<string>>(new Set());
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // charting data — a user without it (billing, stores) has nothing to action
  const mayChart = hasPermission('ipd_clinical');

  const reload = useCallback(() => {
    if (!clinicId || !mayChart) return;
    setLoading(true);
    alertService
      .list({ clinicId, admissionId })
      .then((a) => {
        setAlerts(a);
        setError(null);
        setLastChecked(new Date());
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clinicId, admissionId, mayChart]);

  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, POLL_MS);
    // coming back to a tab left open on the ward station must not show a
    // half-hour-old picture
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(ALERTS_CHANGED_EVENT, reload);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(ALERTS_CHANGED_EVENT, reload);
    };
  }, [reload]);

  const counts = useMemo(() => summarise(alerts), [alerts]);
  const actionable = counts.missed + counts.due;

  // one entry per patient, worst-off patient first — the ward view answers
  // 'who needs me' before 'what exactly', and stays short enough to scan
  const groups = useMemo(() => groupByPatient(alerts), [alerts]);

  const togglePatient = (admission: string) =>
    setOpenPatients((prev) => {
      const next = new Set(prev);
      if (next.has(admission)) next.delete(admission); else next.add(admission);
      return next;
    });

  if (!mayChart) return null;

  const tone: AlertSeverity | 'clear' =
    counts.missed > 0 ? 'missed' : counts.due > 0 ? 'due' : counts.soon > 0 ? 'soon' : 'clear';

  const shell = {
    missed: 'bg-red-50 border-red-300',
    due: 'bg-amber-50 border-amber-300',
    soon: 'bg-blue-50 border-blue-200',
    clear: 'bg-white border-slate-200',
  }[tone];

  const open = (a: IpdAlert) => {
    navigate(`/ipd/admissions/${a.admissionId}?tab=${a.tab}`);
    setExpanded(false);
  };

  return (
    <div className="sticky top-16 lg:top-0 z-30 -mx-6 lg:-mx-8 px-6 lg:px-8 pt-2 pb-3 bg-soft-gray/95 backdrop-blur-sm">
      <div className={`rounded-xl border shadow-sm ${shell}`}>
        {/* ---- summary row: always visible ---------------------------------- */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
        >
          <SummaryIcon tone={tone} />

          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${
              tone === 'missed' ? 'text-red-800'
                : tone === 'due' ? 'text-amber-800'
                  : tone === 'soon' ? 'text-blue-800' : 'text-slate-700'
            }`}>
              {tone === 'clear'
                ? admissionId ? 'Nothing pending for this patient' : 'Ward clear — nothing pending'
                : `${actionable > 0 ? actionable : counts.soon} ${
                  actionable > 0 ? 'item' : 'upcoming item'
                }${(actionable > 0 ? actionable : counts.soon) === 1 ? '' : 's'} ${
                  counts.missed > 0 ? 'need attention' : actionable > 0 ? 'due now' : 'shortly'
                }`}
            </p>
            <p className="text-xs text-slate-500 truncate">
              {error
                ? `Could not read alerts — ${error}`
                : (
                  <>
                    {counts.missed > 0 && <b className="text-red-700">{counts.missed} missed</b>}
                    {counts.missed > 0 && (counts.due > 0 || counts.soon > 0) && ' · '}
                    {counts.due > 0 && <span className="text-amber-700">{counts.due} due now</span>}
                    {counts.due > 0 && counts.soon > 0 && ' · '}
                    {counts.soon > 0 && <span>{counts.soon} due shortly</span>}
                    {!admissionId && groups.length > 1 && (
                      <span> · across {groups.length} patients</span>
                    )}
                    {alerts.length === 0 && (admissionId
                      ? 'No dose or observation is overdue on this chart.'
                      : 'No dose or observation is overdue across the ward.')}
                    {lastChecked && <span className="text-slate-400"> · checked {format(lastChecked, 'HH:mm')}</span>}
                  </>
                )}
            </p>
          </div>

          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); reload(); }}
            title="Check again now"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/70"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </span>
          {alerts.length > 0 && (expanded
            ? <ChevronUp className="w-4 h-4 text-slate-400" />
            : <ChevronDown className="w-4 h-4 text-slate-400" />)}
        </button>

        {/* ---- the list ------------------------------------------------------ */}
        {expanded && alerts.length > 0 && (
          <div className="border-t border-black/5 max-h-80 overflow-y-auto divide-y divide-black/5">
            {admissionId
              ? alerts.map((a) => <AlertRow key={a.id} alert={a} onOpen={open} />)
              : groups.map((g) => (
                <PatientGroup
                  key={g.admissionId}
                  group={g}
                  open={openPatients.has(g.admissionId)}
                  onToggle={() => togglePatient(g.admissionId)}
                  onOpenAlert={open}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One patient's pending work, worst item first. */
interface PatientGroupData {
  admissionId: string;
  patientName: string;
  bedLabel: string | null;
  admissionNumber: string;
  alerts: IpdAlert[];
  counts: Record<AlertSeverity, number>;
  /** the single most overdue item — what the collapsed row has to convey */
  worst: IpdAlert;
}

const severityOrder: Record<AlertSeverity, number> = { missed: 0, due: 1, soon: 2 };

function groupByPatient(alerts: IpdAlert[]): PatientGroupData[] {
  const byAdmission = new Map<string, IpdAlert[]>();
  for (const a of alerts) {
    const bucket = byAdmission.get(a.admissionId);
    if (bucket) bucket.push(a); else byAdmission.set(a.admissionId, [a]);
  }

  return [...byAdmission.entries()]
    .map(([admissionId, list]) => {
      // alertService already ranks by severity then due time, so the first item
      // in each bucket is that patient's worst
      const worst = list[0];
      return {
        admissionId,
        patientName: worst.patientName,
        bedLabel: worst.bedLabel,
        admissionNumber: worst.admissionNumber,
        alerts: list,
        counts: summarise(list),
        worst,
      };
    })
    .sort(
      (a, b) =>
        severityOrder[a.worst.severity] - severityOrder[b.worst.severity] ||
        b.worst.minutesLate - a.worst.minutesLate ||
        a.patientName.localeCompare(b.patientName)
    );
}

function PatientGroup({
  group, open, onToggle, onOpenAlert,
}: {
  group: PatientGroupData;
  open: boolean;
  onToggle: () => void;
  onOpenAlert: (a: IpdAlert) => void;
}) {
  const tone = group.worst.severity;
  const nameColour =
    tone === 'missed' ? 'text-red-800' : tone === 'due' ? 'text-amber-800' : 'text-slate-700';

  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/70 ${
          open ? 'bg-white/60' : ''
        }`}
      >
        {open
          ? <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />
          : <ChevronRight className="w-4 h-4 shrink-0 text-slate-400" />}

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${nameColour}`}>
            {group.patientName}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {group.bedLabel || '—'}
              {group.admissionNumber && ` · ${group.admissionNumber}`}
            </span>
          </p>
          <p className="text-xs text-slate-500 truncate">
            {group.counts.missed > 0 && <b className="text-red-700">{group.counts.missed} missed</b>}
            {group.counts.missed > 0 && (group.counts.due > 0 || group.counts.soon > 0) && ' · '}
            {group.counts.due > 0 && <span className="text-amber-700">{group.counts.due} due now</span>}
            {group.counts.due > 0 && group.counts.soon > 0 && ' · '}
            {group.counts.soon > 0 && <span>{group.counts.soon} due shortly</span>}
            {!open && <span className="text-slate-400"> · oldest {lateLabel(group.worst)}</span>}
          </p>
        </div>

        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
          tone === 'missed' ? 'bg-red-100 text-red-700'
            : tone === 'due' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
        }`}>
          {group.alerts.length}
        </span>
      </button>

      {open && (
        <div className="bg-white/40 border-t border-black/5 divide-y divide-black/5">
          {group.alerts.map((a) => (
            <AlertRow key={a.id} alert={a} onOpen={onOpenAlert} inset />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRow({
  alert: a, onOpen, inset = false,
}: {
  alert: IpdAlert;
  onOpen: (a: IpdAlert) => void;
  /** rendered under a patient header — the name is already on screen */
  inset?: boolean;
}) {
  return (
    <button
      onClick={() => onOpen(a)}
      className={`w-full flex items-center gap-3 py-2 text-left hover:bg-white/70 ${
        inset ? 'pl-11 pr-4' : 'px-4'
      }`}
    >
      <AlertIcon kind={a.kind} severity={a.severity} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-800 truncate">
          {a.title}
          {a.detail && <span className="ml-1.5 text-xs text-slate-500">{a.detail}</span>}
        </p>
        {!inset && (
          <p className="text-xs text-slate-500 truncate">
            {a.patientName}
            {a.bedLabel && ` · ${a.bedLabel}`}
            {a.admissionNumber && ` · ${a.admissionNumber}`}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className={`text-xs font-medium ${
          a.severity === 'missed' ? 'text-red-700'
            : a.severity === 'due' ? 'text-amber-700' : 'text-slate-500'
        }`}>
          {lateLabel(a)}
        </p>
        <p className="text-xs text-slate-400">{format(new Date(a.dueAt), 'dd MMM HH:mm')}</p>
      </div>
    </button>
  );
}

function SummaryIcon({ tone }: { tone: AlertSeverity | 'clear' }) {
  if (tone === 'missed') {
    return (
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-lg bg-red-200 opacity-60" />
        <AlertTriangle className="relative w-5 h-5 text-red-600" />
      </span>
    );
  }
  if (tone === 'due') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100">
        <BellRing className="w-5 h-5 text-amber-600" />
      </span>
    );
  }
  if (tone === 'soon') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100">
        <Clock className="w-5 h-5 text-blue-600" />
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
    </span>
  );
}

function AlertIcon({ kind, severity }: { kind: IpdAlert['kind']; severity: AlertSeverity }) {
  const colour =
    severity === 'missed' ? 'text-red-600'
      : severity === 'due' ? 'text-amber-600' : 'text-slate-400';
  const Icon =
    kind === 'medication' ? Pill
      : kind === 'monitoring' ? HeartPulse
        : kind === 'observation' ? Eye : Clock;
  return <Icon className={`w-4 h-4 shrink-0 ${colour}`} />;
}
