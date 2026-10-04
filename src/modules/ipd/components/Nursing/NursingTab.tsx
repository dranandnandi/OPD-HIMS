import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  HeartPulse, ClipboardList, StickyNote, Plus, Check, SkipForward, Droplets, UtensilsCrossed,
  Stethoscope, Pencil, Trash2, X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { nursingService, VitalsInput } from '../../services/nursingService';
import { canAmendChart } from '../../utils/permissions';
import { monitoringService, INTERVAL_OPTIONS, intervalLabel } from '../../services/monitoringService';
import BloodSection from './BloodSection';
import DietSection from './DietSection';
import DoctorOrdersSection from './DoctorOrdersSection';
import MonitoringSection from './MonitoringSection';
import VoiceDictation from '../Voice/VoiceDictation';
import { notifyAlertsChanged } from '../../services/alertBus';
import type {
  Admission, Vitals, NursingNote, NursingTask, MonitoringOrder, IntakeOutput,
} from '../../types/ipd';

interface Props {
  admission: Admission;
  readOnly: boolean; // discharged admissions are view-only
}

type Section = 'orders' | 'vitals' | 'notes' | 'tasks' | 'diet' | 'blood';

export default function NursingTab({ admission, readOnly }: Props) {
  const admissionId = admission.id;
  const { clinicId, profile } = useAuth();
  // Opens on the doctor's orders: what to give and what to watch is the first
  // thing the ward needs off this chart, before charting anything themselves.
  const [section, setSection] = useState<Section>('orders');
  const [vitals, setVitals] = useState<Vitals[]>([]);
  const [io, setIo] = useState<IntakeOutput[]>([]);
  const [notes, setNotes] = useState<NursingNote[]>([]);
  const [tasks, setTasks] = useState<NursingTask[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringOrder[]>([]);

  const reload = useCallback(async () => {
    // Standing monitoring orders materialise their next block of due readings
    // before the task list is read, so opening the chart is what keeps a
    // 30-minute observation running. Failing to top up must not stop charting.
    try {
      const orders = await monitoringService.listOrders(admissionId);
      setMonitoring(orders);
      await monitoringService.topUp(orders);
    } catch {
      /* non-fatal — the tasks already materialised still load below */
    }

    try {
      const [v, io, n, t] = await Promise.all([
        nursingService.listVitals(admissionId),
        nursingService.listIO(admissionId),
        nursingService.listNotes(admissionId),
        nursingService.listTasks(admissionId),
      ]);
      setVitals(v);
      setIo(io);
      setNotes(n);
      setTasks(t);
      notifyAlertsChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [admissionId]);

  useEffect(() => { void reload(); }, [reload]);

  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;
  const missedTasks = tasks.filter(
    (t) =>
      t.status === 'pending' && t.due_at &&
      Date.now() - new Date(t.due_at).getTime() > (t.grace_minutes ?? 15) * 60_000
  ).length;

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {(
          [
            ['orders', Stethoscope, "Doctor's orders"],
            ['vitals', HeartPulse, `Vitals (${vitals.length})`],
            ['notes', StickyNote, `Notes (${notes.length})`],
            ['tasks', ClipboardList, `Tasks (${pendingTasks} pending${missedTasks ? `, ${missedTasks} missed` : ''})`],
            ['diet', UtensilsCrossed, 'Diet chart'],
            ['blood', Droplets, 'Blood'],
          ] as Array<[Section, typeof HeartPulse, string]>
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${
              section === key
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {!readOnly && ['notes', 'vitals', 'tasks'].includes(section) && (
        <div className="mb-3">
          <VoiceDictation admission={admission} onApplied={reload} />
        </div>
      )}

      {section === 'orders' && <DoctorOrdersSection admissionId={admissionId} />}
      {section === 'vitals' && (
        <VitalsSection
          clinicId={clinicId!}
          admissionId={admissionId}
          vitals={vitals}
          io={io}
          monitoring={monitoring}
          tasks={tasks}
          userId={profile?.id}
          readOnly={readOnly}
          onChange={reload}
        />
      )}
      {section === 'notes' && (
        <NotesSection
          clinicId={clinicId!}
          admissionId={admissionId}
          notes={notes}
          userId={profile?.id}
          readOnly={readOnly}
          onChange={reload}
        />
      )}
      {section === 'tasks' && (
        <TasksSection
          clinicId={clinicId!}
          admissionId={admissionId}
          tasks={tasks}
          userId={profile?.id}
          readOnly={readOnly}
          onChange={reload}
        />
      )}
      {section === 'diet' && (
        <DietSection admission={admission} readOnly={readOnly} />
      )}
      {section === 'blood' && (
        <BloodSection admissionId={admissionId} readOnly={readOnly} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const vitalFields: Array<{ key: keyof VitalsInput; label: string; step?: string }> = [
  { key: 'temperature', label: 'Temp °C', step: '0.1' },
  { key: 'pulse', label: 'Pulse' },
  { key: 'bp_systolic', label: 'BP Sys' },
  { key: 'bp_diastolic', label: 'BP Dia' },
  { key: 'resp_rate', label: 'RR' },
  { key: 'spo2', label: 'SpO₂ %' },
  { key: 'pain_score', label: 'Pain 0-10' },
  { key: 'blood_sugar', label: 'Sugar', step: '0.1' },
];

/** datetime-local wants "yyyy-MM-ddTHH:mm" in LOCAL time, not an ISO string */
const toLocalInput = (iso: string) => format(new Date(iso), "yyyy-MM-dd'T'HH:mm");

/**
 * A round charted this long after it was taken is shown with both times. The
 * lag is real information on a ward sheet — it says the entry is a late one —
 * and charted_at is database-set, so it cannot be tidied away.
 */
const LATE_CHART_MS = 10 * 60_000;

const chartedLate = (v: Vitals): boolean =>
  !!v.charted_at &&
  new Date(v.charted_at).getTime() - new Date(v.recorded_at).getTime() >= LATE_CHART_MS;

function VitalsSection({
  clinicId, admissionId, vitals, io, monitoring, tasks, userId, readOnly, onChange,
}: {
  clinicId: string; admissionId: string; vitals: Vitals[]; io: IntakeOutput[];
  monitoring: MonitoringOrder[]; tasks: NursingTask[];
  userId?: string; readOnly: boolean; onChange: () => void;
}) {
  const { hasPermission } = useAuth();
  const mayAmend = canAmendChart(hasPermission);
  const [form, setForm] = useState<Record<string, string>>({});
  // Blank means "now". A nurse charting at the bedside leaves it alone; one
  // writing up the 06:00 round at 10:00 sets it back to 06:00 rather than
  // letting the sheet claim the reading was taken at 10:00.
  const [takenAt, setTakenAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Vitals | null>(null);

  const save = async () => {
    const input: VitalsInput = {};
    for (const f of vitalFields) {
      const raw = form[f.key];
      if (raw !== undefined && raw !== '') input[f.key] = Number(raw);
    }
    if (Object.keys(input).length === 0) {
      toast.error('Enter at least one vital');
      return;
    }
    if (takenAt && new Date(takenAt).getTime() > Date.now() + 60_000) {
      toast.error('The time taken cannot be in the future');
      return;
    }
    setSaving(true);
    try {
      await nursingService.recordVitals({
        clinicId,
        admissionId,
        vitals: input,
        recordedAt: takenAt ? new Date(takenAt).toISOString() : undefined,
        userId,
      });
      // Charting the reading IS the evidence the observation was done — sign
      // off the occurrence it belongs to rather than making the nurse tick a
      // task as well.
      const signed = await monitoringService
        .completeDueOccurrence({ admissionId, categories: ['monitoring'], userId })
        .catch(() => false);
      toast.success(signed ? 'Vitals recorded — monitoring signed off' : 'Vitals recorded');
      setForm({});
      setTakenAt('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const strike = async (v: Vitals) => {
    const reason = prompt(
      `Strike the ${format(new Date(v.recorded_at), 'dd MMM HH:mm')} round?\n\n` +
        'The entry goes from the chart but the correction trail keeps it. Reason:'
    );
    if (!reason?.trim()) return;
    try {
      await nursingService.deleteChartRow({ table: 'ipd_vitals', id: v.id, reason: reason.trim() });
      toast.success('Entry struck — logged in the correction trail');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      <MonitoringSection
        clinicId={clinicId}
        admissionId={admissionId}
        orders={monitoring}
        tasks={tasks}
        userId={userId}
        readOnly={readOnly}
        onChange={onChange}
      />

      {!readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {vitalFields.map((f) => (
              <label key={f.key} className="text-xs text-slate-500">
                {f.label}
                <input
                  type="number"
                  step={f.step ?? '1'}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
                />
              </label>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-500">
              Time taken
              <input
                type="datetime-local"
                value={takenAt}
                max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                onChange={(e) => setTakenAt(e.target.value)}
                className="mt-0.5 block border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
              />
            </label>
            <button
              onClick={save}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
            >
              {saving ? 'Saving…' : 'Record vitals'}
            </button>
            <p className="text-xs text-slate-400 pb-1.5">
              Leave the time blank for now. Set it back when writing up an earlier round —
              the chart keeps both times.
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Temp</th>
              <th className="px-3 py-2">Pulse</th>
              <th className="px-3 py-2">BP</th>
              <th className="px-3 py-2">RR</th>
              <th className="px-3 py-2">SpO₂</th>
              <th className="px-3 py-2">Pain</th>
              <th className="px-3 py-2">Sugar</th>
              <th className="px-3 py-2">Charted by</th>
              {mayAmend && !readOnly && <th className="px-3 py-2 w-16" />}
            </tr>
          </thead>
          <tbody>
            {vitals.map((v) => (
              <tr key={v.id} className="border-b border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">
                  {format(new Date(v.recorded_at), 'dd MMM HH:mm')}
                  {chartedLate(v) && (
                    <span className="block text-xs text-slate-400">
                      charted {format(new Date(v.charted_at), 'HH:mm')}
                    </span>
                  )}
                  {v.updated_at && (
                    <span
                      className="block text-xs text-amber-600"
                      title={v.amendment_reason ?? undefined}
                    >
                      amended {format(new Date(v.updated_at), 'dd MMM HH:mm')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{v.temperature ?? '—'}</td>
                <td className="px-3 py-2">{v.pulse ?? '—'}</td>
                <td className="px-3 py-2">
                  {v.bp_systolic || v.bp_diastolic ? `${v.bp_systolic ?? '?'}/${v.bp_diastolic ?? '?'}` : '—'}
                </td>
                <td className="px-3 py-2">{v.resp_rate ?? '—'}</td>
                <td className="px-3 py-2">{v.spo2 ?? '—'}</td>
                <td className="px-3 py-2">{v.pain_score ?? '—'}</td>
                <td className="px-3 py-2">{v.blood_sugar ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{v.recorder?.name ?? '—'}</td>
                {mayAmend && !readOnly && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      onClick={() => setEditing(v)}
                      title="Correct this entry"
                      className="text-slate-400 hover:text-blue-600 mr-2"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => strike(v)}
                      title="Strike this entry"
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {vitals.length === 0 && (
              <tr>
                <td colSpan={mayAmend && !readOnly ? 10 : 9} className="px-3 py-6 text-center text-slate-400">
                  No vitals recorded yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <IntakeOutputCard
        clinicId={clinicId}
        admissionId={admissionId}
        io={io}
        userId={userId}
        readOnly={readOnly}
        mayAmend={mayAmend}
        onChange={onChange}
      />

      {editing && (
        <AmendVitalsModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Routes the ward charts against, split the way the sheet prints them */
const IO_ROUTES: Record<'intake' | 'output', string[]> = {
  intake: ['oral', 'iv', 'ryles', 'blood'],
  output: ['urine', 'drain', 'vomit', 'stool', 'aspirate'],
};

/**
 * Intake / output charting. Until now nothing but voice dictation could write
 * ipd_intake_output, so the I/O block on the Nursing Sheet had no source and
 * printed blank. It sits under vitals because that is how the sheet reads and
 * how the ward charts a round.
 */
function IntakeOutputCard({
  clinicId, admissionId, io, userId, readOnly, mayAmend, onChange,
}: {
  clinicId: string; admissionId: string; io: IntakeOutput[];
  userId?: string; readOnly: boolean; mayAmend: boolean; onChange: () => void;
}) {
  const [ioType, setIoType] = useState<'intake' | 'output'>('intake');
  const [route, setRoute] = useState('oral');
  const [volume, setVolume] = useState('');
  const [notes, setNotes] = useState('');
  const [at, setAt] = useState('');
  const [saving, setSaving] = useState(false);

  // Today's balance is what the ward reads off this block; the whole stay is
  // on the printed sheet.
  const today = new Date().toDateString();
  const forToday = io.filter((e) => new Date(e.recorded_at).toDateString() === today);
  const intake = forToday.filter((e) => e.io_type === 'intake').reduce((s, e) => s + e.volume_ml, 0);
  const output = forToday.filter((e) => e.io_type === 'output').reduce((s, e) => s + e.volume_ml, 0);

  const save = async () => {
    const ml = Number(volume);
    if (!Number.isFinite(ml) || ml < 0) {
      toast.error('Enter a volume in ml');
      return;
    }
    if (at && new Date(at).getTime() > Date.now() + 60_000) {
      toast.error('The time cannot be in the future');
      return;
    }
    setSaving(true);
    try {
      await nursingService.recordIO({
        clinicId,
        admissionId,
        ioType,
        route,
        volumeMl: ml,
        notes: notes.trim() || undefined,
        recordedAt: at ? new Date(at).toISOString() : undefined,
        userId,
      });
      toast.success('Charted');
      setVolume('');
      setNotes('');
      setAt('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const strike = async (e: IntakeOutput) => {
    const reason = prompt('Strike this intake/output entry? Reason:');
    if (!reason?.trim()) return;
    try {
      await nursingService.deleteChartRow({
        table: 'ipd_intake_output', id: e.id, reason: reason.trim(),
      });
      toast.success('Entry struck — logged in the correction trail');
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-2">
        <Droplets className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-medium text-slate-700">Intake &amp; Output</h3>
        <span className="text-xs text-slate-500">
          Today — in {intake} ml · out {output} ml · balance {intake - output} ml
        </span>
      </div>

      {!readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">
            Type
            <select
              value={ioType}
              onChange={(e) => {
                const next = e.target.value as 'intake' | 'output';
                setIoType(next);
                setRoute(IO_ROUTES[next][0]);
              }}
              className="mt-0.5 block border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            >
              <option value="intake">Intake</option>
              <option value="output">Output</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Route
            <select
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              className="mt-0.5 block border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            >
              {IO_ROUTES[ioType].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Volume (ml)
            <input
              type="number"
              min="0"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              className="mt-0.5 block w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            Time
            <input
              type="datetime-local"
              value={at}
              max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
              onChange={(e) => setAt(e.target.value)}
              className="mt-0.5 block border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500 flex-1 min-w-[8rem]">
            Notes
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-0.5 block w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={save}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
          >
            {saving ? 'Saving…' : 'Chart'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Route</th>
              <th className="px-3 py-2">Intake</th>
              <th className="px-3 py-2">Output</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2">Charted by</th>
              {mayAmend && !readOnly && <th className="px-3 py-2 w-10" />}
            </tr>
          </thead>
          <tbody>
            {io.map((e) => (
              <tr key={e.id} className="border-b border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">
                  {format(new Date(e.recorded_at), 'dd MMM HH:mm')}
                  {e.charted_at &&
                    new Date(e.charted_at).getTime() - new Date(e.recorded_at).getTime() >=
                      LATE_CHART_MS && (
                      <span className="block text-xs text-slate-400">
                        charted {format(new Date(e.charted_at), 'HH:mm')}
                      </span>
                    )}
                </td>
                <td className="px-3 py-2">{e.route}</td>
                <td className="px-3 py-2">{e.io_type === 'intake' ? `${e.volume_ml} ml` : ''}</td>
                <td className="px-3 py-2">{e.io_type === 'output' ? `${e.volume_ml} ml` : ''}</td>
                <td className="px-3 py-2 text-slate-500">{e.notes ?? ''}</td>
                <td className="px-3 py-2 text-slate-500">{e.recorder?.name ?? '—'}</td>
                {mayAmend && !readOnly && (
                  <td className="px-3 py-2">
                    <button
                      onClick={() => strike(e)}
                      title="Strike this entry"
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {io.length === 0 && (
              <tr>
                <td
                  colSpan={mayAmend && !readOnly ? 7 : 6}
                  className="px-3 py-6 text-center text-slate-400"
                >
                  No intake/output charted yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Correcting a charted round. Every field is editable including the time it
 * was taken — that is the point, a mis-keyed 06:00 as 16:00 has to be
 * fixable — but a reason is mandatory and the change is filed in
 * ipd_chart_amendments with the before and after rows. The database enforces
 * both; this dialog only makes them convenient.
 */
function AmendVitalsModal({
  entry, onClose, onSaved,
}: {
  entry: Vitals; onClose: () => void; onSaved: () => void;
}) {
  const [takenAt, setTakenAt] = useState(toLocalInput(entry.recorded_at));
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      vitalFields.map((f) => [f.key, entry[f.key] != null ? String(entry[f.key]) : ''])
    )
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!reason.trim()) {
      toast.error('Give a reason for the correction');
      return;
    }
    if (new Date(takenAt).getTime() > Date.now() + 60_000) {
      toast.error('The time taken cannot be in the future');
      return;
    }
    const patch: Record<string, unknown> = {
      recorded_at: new Date(takenAt).toISOString(),
    };
    for (const f of vitalFields) {
      const raw = form[f.key];
      patch[f.key] = raw === '' || raw === undefined ? null : Number(raw);
    }
    setSaving(true);
    try {
      await nursingService.amendChartRow({
        table: 'ipd_vitals',
        id: entry.id,
        patch,
        reason: reason.trim(),
      });
      toast.success('Entry corrected — logged in the correction trail');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-slate-800">Correct charted vitals</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-500 mb-3">
          Charted {format(new Date(entry.charted_at), 'dd MMM yyyy, HH:mm')}
          {entry.recorder?.name ? ` by ${entry.recorder.name}` : ''}. That stays as it is —
          only the reading and the time it was taken change.
        </p>

        <label className="text-xs text-slate-500 block mb-3">
          Time taken
          <input
            type="datetime-local"
            value={takenAt}
            max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
            onChange={(e) => setTakenAt(e.target.value)}
            className="mt-0.5 block border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
          />
        </label>

        <div className="grid grid-cols-4 gap-2 mb-3">
          {vitalFields.map((f) => (
            <label key={f.key} className="text-xs text-slate-500">
              {f.label}
              <input
                type="number"
                step={f.step ?? '1'}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
              />
            </label>
          ))}
        </div>

        <label className="text-xs text-slate-500 block">
          Reason for the correction <span className="text-red-500">*</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. charted against the wrong round; BP transposed"
            className="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
          />
        </label>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm px-4 py-1.5 rounded-lg border border-slate-300 text-slate-600">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
          >
            {saving ? 'Saving…' : 'Save correction'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const noteTypes: NursingNote['note_type'][] = ['nursing', 'doctor_round', 'progress', 'handover', 'procedure'];

function NotesSection({
  clinicId, admissionId, notes, userId, readOnly, onChange,
}: {
  clinicId: string; admissionId: string; notes: NursingNote[];
  userId?: string; readOnly: boolean; onChange: () => void;
}) {
  const [noteType, setNoteType] = useState<NursingNote['note_type']>('nursing');
  const [text, setText] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim()) return;
    if (observedAt && new Date(observedAt).getTime() > Date.now() + 60_000) {
      toast.error('The time observed cannot be in the future');
      return;
    }
    setSaving(true);
    try {
      await nursingService.addNote({
        clinicId,
        admissionId,
        noteType,
        note: text.trim(),
        observedAt: observedAt ? new Date(observedAt).toISOString() : undefined,
        userId,
      });
      toast.success('Note added');
      setText('');
      setObservedAt('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {!readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
          <div className="flex flex-wrap items-end gap-2 mb-2">
            <select
              value={noteType}
              onChange={(e) => setNoteType(e.target.value as NursingNote['note_type'])}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            >
              {noteTypes.map((t) => (
                <option key={t} value={t}>{t.replace('_', ' ')}</option>
              ))}
            </select>
            <label className="text-xs text-slate-500">
              Time observed
              <input
                type="datetime-local"
                value={observedAt}
                max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                onChange={(e) => setObservedAt(e.target.value)}
                className="mt-0.5 block border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
              />
            </label>
            <span className="text-xs text-slate-400 pb-1.5">Blank = now</span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Write note…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={save}
            disabled={saving || !text.trim()}
            className="mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
          >
            {saving ? 'Saving…' : 'Add note'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {notes.map((n) => (
          <div key={n.id} className="bg-white rounded-xl border border-slate-200 p-3 text-sm">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span className="uppercase font-medium">
                {n.note_type.replace('_', ' ')}
                {n.author?.name ? ` · ${n.author.name}` : ''}
              </span>
              <span>
                {format(new Date(n.created_at), 'dd MMM yyyy, HH:mm')}
                {n.charted_at &&
                  new Date(n.charted_at).getTime() - new Date(n.created_at).getTime() >=
                    LATE_CHART_MS &&
                  ` (charted ${format(new Date(n.charted_at), 'HH:mm')})`}
              </span>
            </div>
            <p className="text-slate-700 whitespace-pre-wrap">{n.note}</p>
          </div>
        ))}
        {notes.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-400">
            No notes yet
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TasksSection({
  clinicId, admissionId, tasks, userId, readOnly, onChange,
}: {
  clinicId: string; admissionId: string; tasks: NursingTask[];
  userId?: string; readOnly: boolean; onChange: () => void;
}) {
  const [task, setTask] = useState('');
  const [dueAt, setDueAt] = useState('');
  /** 0 = one-off; anything else makes it a standing order that keeps recurring */
  const [repeat, setRepeat] = useState(0);
  const [hours, setHours] = useState('24');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!task.trim()) return;
    setSaving(true);
    try {
      if (repeat > 0) {
        // a repeating task is a standing order, not a row — it expands itself
        // and keeps expanding, the same machinery as "TPR + BP every 30 min"
        await monitoringService.create({
          clinicId,
          admissionId,
          title: task.trim(),
          kind: 'custom',
          intervalMinutes: repeat,
          startAt: dueAt ? new Date(dueAt) : undefined,
          durationHours: hours ? Number(hours) : undefined,
          userId,
        });
        toast.success(`Recurring task ordered — ${intervalLabel(repeat).toLowerCase()}`);
      } else {
        await nursingService.addTask({
          clinicId,
          admissionId,
          task: task.trim(),
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
          userId,
        });
        toast.success('Task added');
      }
      setTask('');
      setDueAt('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: NursingTask['status']) => {
    try {
      await nursingService.setTaskStatus(id, status, userId);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      {!readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap gap-2">
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Task (e.g. 4-hourly vitals, dressing change)…"
            className="flex-1 min-w-48 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            title="First due at"
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          />
          <select
            value={repeat}
            onChange={(e) => setRepeat(Number(e.target.value))}
            title="Repeat"
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value={0}>Once</option>
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>{o.label}</option>
            ))}
          </select>
          {repeat > 0 && (
            <label className="flex items-center gap-1 text-xs text-slate-500">
              for
              <input
                type="number"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                min={1}
                max={168}
                placeholder="24"
                className="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              />
              h
            </label>
          )}
          <button
            onClick={add}
            disabled={saving || !task.trim()}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span
              className={`flex-1 ${
                t.status === 'done' ? 'line-through text-slate-400'
                : t.status === 'skipped' ? 'text-slate-400' : 'text-slate-700'
              }`}
            >
              {t.task}
            </span>
            {t.monitoring_order_id && (
              <span className="text-xs uppercase bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                {t.category === 'monitoring' ? 'monitoring'
                  : t.category === 'intake_output' ? 'I/O'
                    : t.category === 'observation' ? 'observe' : 'recurring'}
              </span>
            )}
            {t.due_at && (
              <span
                className={`text-xs ${
                  t.status === 'pending' && isMissed(t) ? 'text-red-600 font-medium'
                    : t.status === 'pending' && new Date(t.due_at) <= new Date() ? 'text-amber-600 font-medium'
                      : 'text-slate-400'
                }`}
              >
                {t.status === 'pending' && isMissed(t) ? 'MISSED — was due ' : 'due '}
                {format(new Date(t.due_at), 'dd MMM HH:mm')}
              </span>
            )}
            {t.status === 'pending' && !readOnly ? (
              <div className="flex gap-1">
                <button
                  onClick={() => setStatus(t.id, 'done')}
                  title="Mark done"
                  className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setStatus(t.id, 'skipped')}
                  title="Skip"
                  className="p-1.5 rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-100"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <span className="text-xs uppercase text-slate-400">{t.status}</span>
            )}
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-slate-400">No tasks yet</div>
        )}
      </div>
    </div>
  );
}

/** Past its own grace window — the same rule the alert bar applies. */
function isMissed(t: NursingTask): boolean {
  if (!t.due_at) return false;
  return Date.now() - new Date(t.due_at).getTime() > (t.grace_minutes ?? 15) * 60_000;
}
