import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, differenceInCalendarDays } from 'date-fns';
import toast from 'react-hot-toast';
import {
  Stethoscope, Plus, FlaskConical, Pill, Users, CopyPlus, ChevronDown, ChevronRight,
  CalendarDays, Trash2, X, Printer, Truck, Check, Ban, Loader2, Mic,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { treatmentPlanService, TreatmentPlanInput } from '../../services/treatmentPlanService';
import { documentService } from '../../services/documentService';
import {
  medicationService, FREQUENCY_OPTIONS, ROUTE_OPTIONS, MedicineOption,
  medicineLabel, doseSuggestions, defaultRouteFor,
} from '../../services/medicationService';
import MedicinePicker from '../Medications/MedicinePicker';
import { orderService } from '../../services/orderService';
import OrderComposer from '../Orders/OrderComposer';
import { ORDER_STATUS_LABEL, ORDER_STATUS_STYLE } from '../Orders/orderStatus';
import VoiceDictation from '../Voice/VoiceDictation';
import ConsultationsPanel from './ConsultationsPanel';
import type {
  Admission, IpdConsultation, IpdOrderItem, MedicationOrder, TreatmentPlan,
} from '../../types/ipd';

interface Props {
  admission: Admission;
  readOnly: boolean;
}

const FIELDS: Array<{ key: keyof TreatmentPlanInput; label: string; placeholder: string; rows: number }> = [
  { key: 'subjective', label: 'Subjective', placeholder: 'How the patient is today — complaints, sleep, appetite, pain, bowel/bladder…', rows: 2 },
  { key: 'objective', label: 'Objective', placeholder: 'Examination findings, vitals trend, wound/site status…', rows: 2 },
  { key: 'assessment', label: 'Assessment', placeholder: 'Impression, how the problem is progressing…', rows: 2 },
  { key: 'plan', label: "Today's plan", placeholder: 'Continue IV antibiotics, step down O₂, mobilise, plan discharge tomorrow…', rows: 3 },
  { key: 'advice', label: 'Advice / instructions', placeholder: 'Instructions to ward staff and attendants…', rows: 2 },
];

const EMPTY: TreatmentPlanInput = {
  subjective: '', objective: '', assessment: '', plan: '', advice: '',
};

/**
 * The doctor's own date-wise note stream — deliberately not filed under
 * nursing. Every entry can raise the orders it calls for (tests, medicines,
 * cross consultation) so a day's documentation and its actions stay together.
 */
export default function TreatmentPlanTab({ admission, readOnly }: Props) {
  const { clinicId, profile } = useAuth();
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [orderItems, setOrderItems] = useState<IpdOrderItem[]>([]);
  const [medOrders, setMedOrders] = useState<MedicationOrder[]>([]);
  const [consultations, setConsultations] = useState<IpdConsultation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TreatmentPlanInput>(EMPTY);
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<{ planId: string; kind: 'tests' | 'medicine' | 'consult' } | null>(null);
  const [dictationOpen, setDictationOpen] = useState(false);
  /** entry a dictation is filed into — null means it opens a new one */
  const [dictateInto, setDictateInto] = useState<string | null>(null);
  /** false until the user picks a target themselves, so the default can follow the chart */
  const [targetChosen, setTargetChosen] = useState(false);

  const reload = useCallback(() => {
    Promise.all([
      treatmentPlanService.list(admission.id),
      orderService.listItems(admission.id),
      medicationService.listOrders(admission.id),
      treatmentPlanService.listConsultations(admission.id),
    ])
      .then(([p, o, m, c]) => {
        setPlans(p);
        setOrderItems(o);
        setMedOrders(m);
        setConsultations(c);
      })
      .catch((e) => toast.error(e.message));
  }, [admission.id]);

  useEffect(reload, [reload]);

  const byDate = useMemo(() => {
    const map = new Map<string, TreatmentPlan[]>();
    for (const p of plans) {
      if (!map.has(p.plan_date)) map.set(p.plan_date, []);
      map.get(p.plan_date)!.push(p);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [plans]);

  const todayPlans = useMemo(
    () => plans.filter((p) => p.plan_date === new Date().toISOString().slice(0, 10)),
    [plans]
  );
  const hasToday = todayPlans.length > 0;

  /**
   * Dictating again on the same round should extend the entry already written
   * rather than open a rival one, so today's latest entry is the default target
   * until the doctor picks otherwise.
   */
  useEffect(() => {
    if (targetChosen) return;
    setDictateInto(todayPlans[0]?.id ?? null);
  }, [todayPlans, targetChosen]);

  const dictateOn = (planId: string | null) => {
    setDictateInto(planId);
    setTargetChosen(true);
    setDictationOpen(true);
  };

  const startNew = (copyLast = false) => {
    const last = plans[0];
    setEditingId(null);
    setPlanDate(new Date().toISOString().slice(0, 10));
    setForm(
      copyLast && last
        ? {
          subjective: '',
          objective: '',
          assessment: last.assessment ?? '',
          plan: last.plan ?? '',
          advice: last.advice ?? '',
        }
        : EMPTY
    );
    setShowForm(true);
  };

  const startEdit = (p: TreatmentPlan) => {
    setEditingId(p.id);
    setPlanDate(p.plan_date);
    setForm({
      subjective: p.subjective ?? '',
      objective: p.objective ?? '',
      assessment: p.assessment ?? '',
      plan: p.plan ?? '',
      advice: p.advice ?? '',
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!clinicId) return;
    setSaving(true);
    try {
      if (editingId) {
        await treatmentPlanService.update(editingId, { ...form, planDate });
        toast.success('Plan entry updated');
      } else {
        await treatmentPlanService.create({
          clinicId,
          admissionId: admission.id,
          userId: profile?.id,
          input: { ...form, planDate },
        });
        toast.success('Plan documented');
      }
      setShowForm(false);
      setForm(EMPTY);
      setEditingId(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: TreatmentPlan) => {
    if (!confirm(`Delete the ${format(new Date(p.plan_date), 'dd MMM')} plan entry?`)) return;
    try {
      await treatmentPlanService.remove(p.id);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const dayOfStay = (dateStr: string) =>
    differenceInCalendarDays(new Date(dateStr), new Date(admission.admission_datetime)) + 1;

  const printSheet = () =>
    documentService.printPlanSheet({
      admission, clinicId: clinicId!, plans,
    });

  return (
    <div>
      {plans.length > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={printSheet}
            title="Print the date-wise plan sheet for the paper file"
            className="flex items-center gap-1.5 border border-slate-300 text-slate-600 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50"
          >
            <Printer className="w-4 h-4" /> Print plan sheet
          </button>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={() => startNew(false)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded-lg"
          >
            <Plus className="w-4 h-4" /> {hasToday ? "Add another entry today" : "Document today's plan"}
          </button>
          {plans.length > 0 && (
            <button
              onClick={() => startNew(true)}
              title="Start from the last entry's assessment, plan and advice"
              className="flex items-center gap-1.5 border border-slate-300 text-slate-600 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50"
            >
              <CopyPlus className="w-4 h-4" /> Continue previous plan
            </button>
          )}
          {/* full width once expanded so the review panel is not squeezed
              between the buttons on either side of it */}
          <div className={dictationOpen ? 'w-full order-last' : ''}>
            <VoiceDictation
              admission={admission}
              todayPlans={todayPlans}
              open={dictationOpen}
              onOpenChange={setDictationOpen}
              targetPlanId={dictateInto}
              onTargetPlanIdChange={(id) => { setDictateInto(id); setTargetChosen(true); }}
              onApplied={() => { setTargetChosen(false); reload(); }}
            />
          </div>
          {!hasToday && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
              No plan documented for today yet
            </span>
          )}
        </div>
      )}

      {showForm && !readOnly && (
        <div className="bg-white rounded-xl border border-blue-200 p-4 mb-3">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Stethoscope className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-slate-800">
              {editingId ? 'Edit plan entry' : 'New plan entry'}
            </span>
            <label className="flex items-center gap-1.5 text-xs text-slate-500 ml-2">
              <CalendarDays className="w-3.5 h-3.5" />
              <input
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-700"
              />
            </label>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="ml-auto p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {FIELDS.map((f) => (
              <label key={String(f.key)} className="block text-xs text-slate-500">
                {f.label}
                <textarea
                  value={(form[f.key] as string) ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  rows={f.rows}
                  placeholder={f.placeholder}
                  className="mt-0.5 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800"
                />
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
            >
              {saving ? 'Saving…' : editingId ? 'Update entry' : 'Save plan'}
            </button>
          </div>
        </div>
      )}

      {/* Date-wise timeline */}
      <div className="space-y-4">
        {byDate.map(([date, entries]) => (
          <div key={date}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-slate-800">
                {format(new Date(date), 'EEE, dd MMM yyyy')}
              </span>
              <span className="text-xs text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                Day {Math.max(1, dayOfStay(date))} of stay
              </span>
              {date === new Date().toISOString().slice(0, 10) && (
                <span className="text-xs text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">today</span>
              )}
              <span className="flex-1 h-px bg-slate-200" />
            </div>

            <div className="space-y-2">
              {entries.map((p) => (
                <PlanEntryCard
                  key={p.id}
                  plan={p}
                  admission={admission}
                  readOnly={readOnly}
                  orderItems={orderItems.filter((i) => i.parent_order?.treatment_plan_id === p.id)}
                  allOrderItems={orderItems}
                  medOrders={medOrders.filter((m) => m.treatment_plan_id === p.id)}
                  consultations={consultations.filter((c) => c.treatment_plan_id === p.id)}
                  activeAction={action?.planId === p.id ? action.kind : null}
                  onAction={(kind) =>
                    setAction((a) => (a?.planId === p.id && a.kind === kind ? null : { planId: p.id, kind }))
                  }
                  onDone={() => { setAction(null); reload(); }}
                  onEdit={() => startEdit(p)}
                  onDelete={() => remove(p)}
                  onDictate={() => dictateOn(p.id)}
                  dictating={dictationOpen && dictateInto === p.id}
                />
              ))}
            </div>
          </div>
        ))}

        {plans.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
            No treatment plan documented yet — write today's plan, or dictate it and it will fill these fields.
          </div>
        )}
      </div>

      {/* Cross consultations across the whole admission */}
      <div className="mt-6">
        <ConsultationsPanel
          admission={admission}
          consultations={consultations}
          readOnly={readOnly}
          onChange={reload}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlanEntryCard({
  plan, admission, readOnly, orderItems, allOrderItems, medOrders, consultations,
  activeAction, onAction, onDone, onEdit, onDelete, onDictate, dictating,
}: {
  plan: TreatmentPlan;
  admission: Admission;
  readOnly: boolean;
  orderItems: IpdOrderItem[];
  /** every item on the admission — used to warn before ordering a duplicate */
  allOrderItems: IpdOrderItem[];
  medOrders: MedicationOrder[];
  consultations: IpdConsultation[];
  activeAction: 'tests' | 'medicine' | 'consult' | null;
  onAction: (kind: 'tests' | 'medicine' | 'consult') => void;
  onDone: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** point the dictation panel at this entry so what is said is added to it */
  onDictate: () => void;
  dictating: boolean;
}) {
  const { clinicId, profile } = useAuth();
  const [open, setOpen] = useState(true);

  const rows: Array<[string, string | null]> = [
    ['Subjective', plan.subjective],
    ['Objective', plan.objective],
    ['Assessment', plan.assessment],
    ['Plan', plan.plan],
    ['Advice', plan.advice],
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <button onClick={() => setOpen((o) => !o)} className="text-slate-400 hover:text-slate-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <span>{format(new Date(plan.recorded_at), 'HH:mm')}</span>
        {plan.doctor?.name && <span>· Dr. {plan.doctor.name.replace(/^dr\.?\s*/i, '')}</span>}
        {plan.voice_transcript && (
          <span className="text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5">dictated</span>
        )}
        {!readOnly && (
          <span className="ml-auto flex items-center gap-2">
            <button onClick={onEdit} className="text-blue-600 hover:underline">Edit</button>
            <button onClick={onDelete} className="text-slate-400 hover:text-red-600" title="Delete entry">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
      </div>

      {open && (
        <>
          <div className="mt-2 space-y-1 text-sm">
            {rows.filter(([, v]) => v && v.trim()).map(([label, v]) => (
              <p key={label} className="text-slate-700 whitespace-pre-wrap">
                <span className={`text-slate-400 ${label === 'Plan' ? 'font-medium text-slate-500' : ''}`}>
                  {label}:
                </span>{' '}
                <span className={label === 'Plan' ? 'font-medium' : ''}>{v}</span>
              </p>
            ))}
          </div>

          {/* What was actually said — kept with the entry so a dictated round
              can be checked against the fields it filled */}
          {plan.voice_transcript && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-violet-600">Dictation transcript</summary>
              <p className="mt-1 p-2 bg-violet-50 border border-violet-100 rounded text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {plan.voice_transcript}
              </p>
            </details>
          )}

          {/* What this entry raised */}
          {(orderItems.length > 0 || medOrders.length > 0 || consultations.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {orderItems.map((i) => (
                <OrderChip key={i.id} item={i} readOnly={readOnly} onChanged={onDone} />
              ))}
              {medOrders.map((m) => (
                <span key={m.id} className="bg-pink-50 border border-pink-200 text-pink-800 rounded px-1.5 py-0.5">
                  💊 {m.medicine_name} {m.dose ?? ''} {m.frequency_code.toUpperCase()}
                  {m.status !== 'active' && <span className="text-pink-500"> · {m.status}</span>}
                </span>
              ))}
              {consultations.map((c) => (
                <span key={c.id} className="bg-indigo-50 border border-indigo-200 text-indigo-800 rounded px-1.5 py-0.5">
                  🩺 {c.specialty ?? 'consult'} · {c.status}
                </span>
              ))}
            </div>
          )}

          {!readOnly && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <ActionButton active={activeAction === 'tests'} onClick={() => onAction('tests')} icon={FlaskConical}>
                Order tests
              </ActionButton>
              <ActionButton active={activeAction === 'medicine'} onClick={() => onAction('medicine')} icon={Pill}>
                Add medicine
              </ActionButton>
              <ActionButton active={activeAction === 'consult'} onClick={() => onAction('consult')} icon={Users}>
                Cross consultation
              </ActionButton>
              {plan.plan_date === new Date().toISOString().slice(0, 10) && (
                <ActionButton active={dictating} onClick={onDictate} icon={Mic}>
                  Add by dictation
                </ActionButton>
              )}
            </div>
          )}

          {activeAction === 'tests' && (
            <div className="mt-2">
              <OrderComposer
                clinicId={clinicId!}
                admission={admission}
                userId={profile?.id}
                treatmentPlanId={plan.id}
                existingItems={allOrderItems}
                onPlaced={onDone}
                onCancel={() => onAction('tests')}
                compact
              />
            </div>
          )}
          {activeAction === 'medicine' && (
            <PlanMedicineForm
              clinicId={clinicId!}
              admissionId={admission.id}
              planId={plan.id}
              userId={profile?.id}
              onDone={onDone}
              onCancel={() => onAction('medicine')}
            />
          )}
          {activeAction === 'consult' && (
            <PlanConsultForm
              clinicId={clinicId!}
              admissionId={admission.id}
              planId={plan.id}
              userId={profile?.id}
              onDone={onDone}
              onCancel={() => onAction('consult')}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * A test raised by this entry. The order is already placed — what the chip
 * reports is where the sample has got to — so the ward actions that move it
 * along live on the chip itself instead of only on the Orders tab.
 */
function OrderChip({
  item, readOnly, onChanged,
}: {
  item: IpdOrderItem; readOnly: boolean; onChanged: () => void;
}) {
  const { clinicId, profile } = useAuth();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, done: string) => {
    if (!clinicId) return;
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: IpdOrderItem['status'], done: string) =>
    run(() => orderService.setItemStatus({ clinicId: clinicId!, itemId: item.id, status, userId: profile?.id }), done);

  const cancel = () => {
    const reason = prompt(`Cancel "${item.service?.name ?? 'order'}" — reason?`);
    if (reason === null) return;
    run(
      () => orderService.cancelItem({ clinicId: clinicId!, item, reason: reason || 'Cancelled', userId: profile?.id }),
      'Order cancelled — charge reversed'
    );
  };

  const actionable = !readOnly && !['done', 'cancelled'].includes(item.status);

  return (
    <span
      className={`inline-flex items-center gap-1 border rounded px-1.5 py-0.5 ${
        item.status === 'cancelled'
          ? 'bg-slate-50 border-slate-200 text-slate-400 line-through'
          : 'bg-orange-50 border-orange-200 text-orange-800'
      }`}
    >
      🧪 {item.service?.name ?? 'test'}
      <span className={`text-[10px] rounded px-1 ${ORDER_STATUS_STYLE[item.status]}`}>
        {ORDER_STATUS_LABEL[item.status]}
      </span>
      {busy && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
      {actionable && !busy && (
        <>
          {item.status === 'pending' && (
            <button
              onClick={() => setStatus('sent_external', 'Sample sent')}
              title="Sample collected / patient sent — mark sent to lab"
              className="p-0.5 rounded text-blue-700 hover:bg-blue-100"
            >
              <Truck className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setStatus('done', 'Marked done')}
            title="Mark completed"
            className="p-0.5 rounded text-emerald-700 hover:bg-emerald-100"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={cancel}
            title="Cancel this test (reverses the charge)"
            className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
          >
            <Ban className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </span>
  );
}

function ActionButton({
  active, onClick, icon: Icon, children,
}: {
  active: boolean; onClick: () => void; icon: typeof FlaskConical; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 text-xs rounded-lg px-2 py-1 border ${
        active ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

function PlanMedicineForm({
  clinicId, admissionId, planId, userId, onDone, onCancel,
}: {
  clinicId: string; admissionId: string; planId: string; userId?: string;
  onDone: () => void; onCancel: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MedicineOption | null>(null);
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('oral');
  const [frequency, setFrequency] = useState('bd');
  const [days, setDays] = useState('3');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [doseTouched, setDoseTouched] = useState(false);
  const [routeTouched, setRouteTouched] = useState(false);

  /** fill dose from the strength and route from the dosage form on pick */
  const pickMedicine = (m: MedicineOption | null) => {
    setSelected(m);
    if (!m) return;
    if (!doseTouched) {
      const [suggested] = doseSuggestions(m);
      if (suggested) setDose(suggested);
    }
    if (!routeTouched) {
      const r = defaultRouteFor(m);
      if (r) setRoute(r);
    }
  };

  const create = async () => {
    const name = selected?.name ?? search.trim();
    if (!name) { toast.error('Pick a medicine or type a name'); return; }
    setSaving(true);
    try {
      await medicationService.createOrder({
        clinicId,
        admissionId,
        medicineId: selected?.id,
        medicineName: selected ? medicineLabel(selected) : name,
        dose: dose || undefined,
        route,
        frequencyCode: frequency,
        days: Number(days) || 3,
        instructions: instructions || undefined,
        treatmentPlanId: planId,
        userId,
      });
      toast.success('Medication ordered — eMAR schedule generated');
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 border border-slate-200 rounded-lg p-2.5 bg-slate-50">
      <div className="flex flex-wrap gap-2">
        <MedicinePicker
          clinicId={clinicId}
          value={search}
          selected={selected}
          onChange={setSearch}
          onSelect={pickMedicine}
          placeholder="Medicine…"
          className="flex-1 min-w-48"
        />
        <input
          value={dose}
          onChange={(e) => { setDose(e.target.value); setDoseTouched(true); }}
          list="plan-dose-options"
          placeholder="Dose"
          className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
        />
        <datalist id="plan-dose-options">
          {doseSuggestions(selected).map((d) => <option key={d} value={d} />)}
        </datalist>
        <select value={route} onChange={(e) => { setRoute(e.target.value); setRouteTouched(true); }}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          {ROUTE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          {FREQUENCY_OPTIONS.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
        </select>
        <input type="number" min={1} max={14} value={days} onChange={(e) => setDays(e.target.value)}
          title="Days" className="w-14 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        <input
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Instructions (after food, slow IV…)"
          className="flex-1 min-w-44 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
        />
        <button onClick={onCancel} className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5 bg-white">
          Cancel
        </button>
        <button
          onClick={create}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
        >
          {saving ? 'Adding…' : 'Add medicine'}
        </button>
      </div>
    </div>
  );
}

function PlanConsultForm({
  clinicId, admissionId, planId, userId, onDone, onCancel,
}: {
  clinicId: string; admissionId: string; planId: string; userId?: string;
  onDone: () => void; onCancel: () => void;
}) {
  const [specialty, setSpecialty] = useState('');
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<IpdConsultation['urgency']>('routine');
  const [saving, setSaving] = useState(false);

  const request = async () => {
    if (!reason.trim()) { toast.error('Say why the opinion is needed'); return; }
    setSaving(true);
    try {
      await treatmentPlanService.requestConsultation({
        clinicId,
        admissionId,
        treatmentPlanId: planId,
        specialty: specialty.trim() || null,
        reason: reason.trim(),
        urgency,
        userId,
      });
      toast.success('Consultation requested');
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 border border-slate-200 rounded-lg p-2.5 bg-slate-50 flex flex-wrap gap-2">
      <input
        value={specialty}
        onChange={(e) => setSpecialty(e.target.value)}
        placeholder="Specialty (cardiology…)"
        className="w-44 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for the opinion"
        className="flex-1 min-w-48 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
      />
      <select
        value={urgency}
        onChange={(e) => setUrgency(e.target.value as IpdConsultation['urgency'])}
        className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
      >
        <option value="routine">Routine</option>
        <option value="urgent">Urgent</option>
        <option value="stat">STAT</option>
      </select>
      <button onClick={onCancel} className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5 bg-white">
        Cancel
      </button>
      <button
        onClick={request}
        disabled={saving}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
      >
        {saving ? 'Requesting…' : 'Request'}
      </button>
    </div>
  );
}
