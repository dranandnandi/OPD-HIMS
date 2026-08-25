import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Activity, AlarmClock, ChevronUp, Plus, Square } from 'lucide-react';
import {
  monitoringService, MONITORING_PRESETS, INTERVAL_OPTIONS, VITAL_FIELD_OPTIONS,
  intervalLabel,
} from '../../services/monitoringService';
import type { MonitoringOrder, NursingTask } from '../../types/ipd';

interface Props {
  clinicId: string;
  admissionId: string;
  orders: MonitoringOrder[];
  /** occurrence rows already loaded by the Nursing tab */
  tasks: NursingTask[];
  userId?: string;
  readOnly: boolean;
  onChange: () => void;
}

/**
 * Standing monitoring orders, created where the ward actually looks for them —
 * on the vitals chart.
 *
 * "TPR, BP every 30 min" was previously unorderable: vitals could only be
 * charted after the fact, so a reading that never happened looked exactly like
 * a reading that was not due. Ordering it here expands due occurrences into the
 * Tasks list, and anything not charted in time surfaces in the alert bar at the
 * top of the screen.
 */
export default function MonitoringSection({
  clinicId, admissionId, orders, tasks, userId, readOnly, onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const active = orders.filter((o) => o.status === 'active');

  // pending occurrence stats per order, for the "next due / missed" line
  const stats = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, { next: Date | null; missed: number }>();
    for (const t of tasks) {
      if (!t.monitoring_order_id || t.status !== 'pending' || !t.due_at) continue;
      const due = new Date(t.due_at);
      const entry = map.get(t.monitoring_order_id) ?? { next: null, missed: 0 };
      if (now - due.getTime() > (t.grace_minutes ?? 15) * 60_000) entry.missed += 1;
      if (!entry.next || due < entry.next) entry.next = due;
      map.set(t.monitoring_order_id, entry);
    }
    return map;
  }, [tasks]);

  const stop = async (order: MonitoringOrder) => {
    const reason = prompt(`Stop "${order.title}"? Reason (optional)`) ?? undefined;
    try {
      await monitoringService.stop(order.id, reason);
      toast.success('Monitoring order stopped');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 mb-3">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
        <Activity className="w-4 h-4 text-blue-600" />
        <h3 className="text-sm font-medium text-slate-700 flex-1">
          Monitoring orders ({active.length} running)
        </h3>
        {!readOnly && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-sm text-blue-700 border border-blue-200 bg-blue-50 rounded-lg px-2.5 py-1.5 hover:bg-blue-100"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {open ? 'Close' : 'Order monitoring'}
          </button>
        )}
      </div>

      {open && !readOnly && (
        <NewMonitoringOrder
          clinicId={clinicId}
          admissionId={admissionId}
          userId={userId}
          onCreated={() => { setOpen(false); onChange(); }}
        />
      )}

      {active.length === 0 ? (
        <p className="px-3 py-3 text-sm text-slate-400">
          Nothing is being monitored on a schedule. Order &ldquo;TPR + BP every 30 min&rdquo; here and
          each reading becomes a due task — anything not charted in time shows in the alert bar.
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {active.map((o) => {
            const s = stats.get(o.id);
            return (
              <div key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <AlarmClock className={`w-4 h-4 shrink-0 ${s?.missed ? 'text-red-600' : 'text-slate-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-slate-800">
                    {o.title}
                    <span className="ml-1.5 text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                      {intervalLabel(o.interval_minutes)}
                    </span>
                    {s && s.missed > 0 && (
                      <span className="ml-1.5 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                        {s.missed} missed
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {o.kind === 'vitals' && o.fields.length > 0 && (
                      <>{o.fields.map(fieldLabel).join(', ')} · </>
                    )}
                    {s?.next
                      ? `next due ${format(s.next, 'dd MMM HH:mm')}`
                      : 'no occurrence pending'}
                    {o.end_at && ` · till ${format(new Date(o.end_at), 'dd MMM HH:mm')}`}
                  </p>
                  {o.instructions && <p className="text-xs text-slate-500 mt-0.5">{o.instructions}</p>}
                </div>
                {!readOnly && (
                  <button
                    onClick={() => stop(o)}
                    title="Stop monitoring"
                    className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const fieldLabel = (key: string) =>
  VITAL_FIELD_OPTIONS.find((v) => v.key === key)?.label ?? key;

// ---------------------------------------------------------------------------

function NewMonitoringOrder({
  clinicId, admissionId, userId, onCreated,
}: {
  clinicId: string; admissionId: string; userId?: string; onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<MonitoringOrder['kind']>('vitals');
  const [fields, setFields] = useState<string[]>([]);
  const [interval, setInterval] = useState(60);
  const [duration, setDuration] = useState('24');   // hours; '' = until stopped
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);

  const applyPreset = (i: number) => {
    const p = MONITORING_PRESETS[i];
    setTitle(p.title);
    setKind(p.kind);
    setFields(p.fields);
    setInterval(p.intervalMinutes);
    setInstructions(p.instructions ?? '');
  };

  const toggleField = (key: string) =>
    setFields((f) => (f.includes(key) ? f.filter((x) => x !== key) : [...f, key]));

  const save = async () => {
    if (!title.trim()) {
      toast.error('Name the observation — e.g. TPR + BP');
      return;
    }
    setSaving(true);
    try {
      await monitoringService.create({
        clinicId,
        admissionId,
        title,
        kind,
        fields: kind === 'vitals' ? fields : [],
        intervalMinutes: interval,
        durationHours: duration ? Number(duration) : undefined,
        instructions: instructions || undefined,
        userId,
      });
      toast.success(`Ordered — ${intervalLabel(interval).toLowerCase()}, first reading due shortly`);
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-3 py-3 border-b border-slate-100 bg-slate-50/60">
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        <span className="text-xs text-slate-500 self-center mr-0.5">Common orders:</span>
        {MONITORING_PRESETS.map((p, i) => (
          <button
            key={`${p.title}-${p.intervalMinutes}`}
            onClick={() => applyPreset(i)}
            className="text-xs border border-slate-300 bg-white rounded-full px-2.5 py-1 text-slate-600 hover:border-blue-400 hover:text-blue-700"
          >
            {p.title} · {intervalLabel(p.intervalMinutes).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What to observe (TPR + BP, urine output, abdominal distension)…"
          className="flex-1 min-w-56 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as MonitoringOrder['kind'])}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
        >
          <option value="vitals">Chart vitals</option>
          <option value="observation">Observe / watch for</option>
          <option value="intake_output">Intake / output</option>
          <option value="custom">Other</option>
        </select>
        <select
          value={interval}
          onChange={(e) => setInterval(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
        >
          {INTERVAL_OPTIONS.map((o) => (
            <option key={o.minutes} value={o.minutes}>{o.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          for
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            min={1}
            max={168}
            placeholder="24"
            className="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          />
          h
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
        >
          <Plus className="w-4 h-4" /> {saving ? 'Ordering…' : 'Order'}
        </button>
      </div>

      {kind === 'vitals' && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          <span className="text-xs text-slate-500 self-center mr-0.5">Chart:</span>
          {VITAL_FIELD_OPTIONS.map((v) => (
            <button
              key={v.key}
              onClick={() => toggleField(v.key)}
              className={`text-xs rounded-full px-2.5 py-1 border ${
                fields.includes(v.key)
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-300 text-slate-600'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      <input
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Instructions to the ward (optional) — e.g. inform doctor if SBP < 90"
        className="w-full mt-2 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
      />
      <p className="text-xs text-slate-400 mt-1.5">
        Leave the hours blank to run until stopped. Each due reading appears under Tasks, and
        charting the vitals signs it off automatically.
      </p>
    </div>
  );
}
