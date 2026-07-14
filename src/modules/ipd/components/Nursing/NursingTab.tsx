import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { HeartPulse, ClipboardList, StickyNote, Plus, Check, SkipForward, Droplets } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { nursingService, VitalsInput } from '../../services/nursingService';
import BloodSection from './BloodSection';
import type { Vitals, NursingNote, NursingTask } from '../../types/ipd';

interface Props {
  admissionId: string;
  readOnly: boolean; // discharged admissions are view-only
}

type Section = 'vitals' | 'notes' | 'tasks' | 'blood';

export default function NursingTab({ admissionId, readOnly }: Props) {
  const { clinicId, profile } = useAuth();
  const [section, setSection] = useState<Section>('vitals');
  const [vitals, setVitals] = useState<Vitals[]>([]);
  const [notes, setNotes] = useState<NursingNote[]>([]);
  const [tasks, setTasks] = useState<NursingTask[]>([]);

  const reload = useCallback(() => {
    Promise.all([
      nursingService.listVitals(admissionId),
      nursingService.listNotes(admissionId),
      nursingService.listTasks(admissionId),
    ])
      .then(([v, n, t]) => {
        setVitals(v);
        setNotes(n);
        setTasks(t);
      })
      .catch((e) => toast.error(e.message));
  }, [admissionId]);

  useEffect(reload, [reload]);

  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {(
          [
            ['vitals', HeartPulse, `Vitals (${vitals.length})`],
            ['notes', StickyNote, `Notes (${notes.length})`],
            ['tasks', ClipboardList, `Tasks (${pendingTasks} pending)`],
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

      {section === 'vitals' && (
        <VitalsSection
          clinicId={clinicId!}
          admissionId={admissionId}
          vitals={vitals}
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

function VitalsSection({
  clinicId, admissionId, vitals, userId, readOnly, onChange,
}: {
  clinicId: string; admissionId: string; vitals: Vitals[];
  userId?: string; readOnly: boolean; onChange: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    try {
      await nursingService.recordVitals({ clinicId, admissionId, vitals: input, userId });
      toast.success('Vitals recorded');
      setForm({});
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
          <button
            onClick={save}
            disabled={saving}
            className="mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
          >
            {saving ? 'Saving…' : 'Record vitals'}
          </button>
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
            </tr>
          </thead>
          <tbody>
            {vitals.map((v) => (
              <tr key={v.id} className="border-b border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">{format(new Date(v.recorded_at), 'dd MMM HH:mm')}</td>
                <td className="px-3 py-2">{v.temperature ?? '—'}</td>
                <td className="px-3 py-2">{v.pulse ?? '—'}</td>
                <td className="px-3 py-2">
                  {v.bp_systolic || v.bp_diastolic ? `${v.bp_systolic ?? '?'}/${v.bp_diastolic ?? '?'}` : '—'}
                </td>
                <td className="px-3 py-2">{v.resp_rate ?? '—'}</td>
                <td className="px-3 py-2">{v.spo2 ?? '—'}</td>
                <td className="px-3 py-2">{v.pain_score ?? '—'}</td>
                <td className="px-3 py-2">{v.blood_sugar ?? '—'}</td>
              </tr>
            ))}
            {vitals.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No vitals recorded yet</td></tr>
            )}
          </tbody>
        </table>
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
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await nursingService.addNote({ clinicId, admissionId, noteType, note: text.trim(), userId });
      toast.success('Note added');
      setText('');
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
          <div className="flex gap-2 mb-2">
            <select
              value={noteType}
              onChange={(e) => setNoteType(e.target.value as NursingNote['note_type'])}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            >
              {noteTypes.map((t) => (
                <option key={t} value={t}>{t.replace('_', ' ')}</option>
              ))}
            </select>
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
              <span className="uppercase font-medium">{n.note_type.replace('_', ' ')}</span>
              <span>{format(new Date(n.created_at), 'dd MMM yyyy, HH:mm')}</span>
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
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!task.trim()) return;
    setSaving(true);
    try {
      await nursingService.addTask({
        clinicId,
        admissionId,
        task: task.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        userId,
      });
      toast.success('Task added');
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
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          />
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
            {t.due_at && (
              <span
                className={`text-xs ${
                  t.status === 'pending' && new Date(t.due_at) < new Date()
                    ? 'text-red-600 font-medium'
                    : 'text-slate-400'
                }`}
              >
                due {format(new Date(t.due_at), 'dd MMM HH:mm')}
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
