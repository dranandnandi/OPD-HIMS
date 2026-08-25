import { useCallback, useEffect, useState } from 'react';
import { format, isToday, isPast } from 'date-fns';
import toast from 'react-hot-toast';
import { Pill, Plus, Square, Check, Ban, HandMetal, CalendarClock, Clock, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  medicationService, MedicineOption, FREQUENCY_OPTIONS, ROUTE_OPTIONS,
  medicineLabel, doseSuggestions, defaultRouteFor,
  defaultTimesFor, isScheduledFrequency, normaliseTimes, formatDoseTime, orderDoseTimes,
} from '../../services/medicationService';
import { storeService, Store } from '../../services/storeService';
import MedicinePicker from './MedicinePicker';
import DoseTimesEditor from './DoseTimesEditor';
import { notifyAlertsChanged } from '../../services/alertBus';
import type { MedicationOrder, MedicationScheduleSlot } from '../../types/ipd';

interface Props {
  admissionId: string;
  readOnly: boolean;
}

type Section = 'emar' | 'orders';

export default function MedicationsTab({ admissionId, readOnly }: Props) {
  const { clinicId, profile } = useAuth();
  const [section, setSection] = useState<Section>('emar');
  const [orders, setOrders] = useState<MedicationOrder[]>([]);
  const [schedule, setSchedule] = useState<MedicationScheduleSlot[]>([]);

  const reload = useCallback(() => {
    Promise.all([
      medicationService.listOrders(admissionId),
      medicationService.listSchedule(admissionId),
    ])
      .then(([o, s]) => {
        setOrders(o);
        setSchedule(s);
        notifyAlertsChanged();
      })
      .catch((e) => toast.error(e.message));
  }, [admissionId]);

  useEffect(reload, [reload]);

  const dueCount = schedule.filter(
    (s) => s.status === 'due' && new Date(s.scheduled_at) <= new Date()
  ).length;

  return (
    <div>
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setSection('emar')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${
            section === 'emar' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'
          }`}
        >
          <CalendarClock className="w-4 h-4" />
          eMAR {dueCount > 0 && <span className="bg-red-500 text-white text-xs rounded-full px-1.5">{dueCount} due</span>}
        </button>
        <button
          onClick={() => setSection('orders')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${
            section === 'orders' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'
          }`}
        >
          <Pill className="w-4 h-4" />
          Orders ({orders.filter((o) => o.status === 'active').length} active)
        </button>
      </div>

      {section === 'orders' && (
        <OrdersSection
          clinicId={clinicId!}
          admissionId={admissionId}
          orders={orders}
          userId={profile?.id}
          readOnly={readOnly}
          onChange={reload}
        />
      )}
      {section === 'emar' && (
        <EmarSection
          clinicId={clinicId!}
          admissionId={admissionId}
          schedule={schedule}
          orders={orders}
          userId={profile?.id}
          readOnly={readOnly}
          onChange={reload}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function OrdersSection({
  clinicId, admissionId, orders, userId, readOnly, onChange,
}: {
  clinicId: string; admissionId: string; orders: MedicationOrder[];
  userId?: string; readOnly: boolean; onChange: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MedicineOption | null>(null);
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('oral');
  const [frequency, setFrequency] = useState('bd');
  const [days, setDays] = useState('3');
  const [saving, setSaving] = useState(false);
  /** once the dose/route is typed by hand, picking a medicine stops overwriting it */
  const [doseTouched, setDoseTouched] = useState(false);
  const [routeTouched, setRouteTouched] = useState(false);
  /** the clock times this order will actually run on — seeded from the
      frequency, then owned by the user ("8 PM and 8 AM") */
  const [times, setTimes] = useState<string[]>(() => defaultTimesFor('bd'));
  const [startAt, setStartAt] = useState(() => localInputValue(new Date()));
  const [retimingId, setRetimingId] = useState<string | null>(null);

  const scheduled = isScheduledFrequency(frequency);

  /** changing the frequency re-seeds the suggested times; they stay editable */
  const pickFrequency = (code: string) => {
    setFrequency(code);
    if (isScheduledFrequency(code)) setTimes(defaultTimesFor(code));
  };

  /** picking from the formulary fills the dose from the strength and the route
      from the dosage form — both stay editable */
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
    if (!name) {
      toast.error('Pick a medicine or type a name');
      return;
    }
    if (scheduled && normaliseTimes(times).length === 0) {
      toast.error('Set at least one dose time');
      return;
    }
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
        doseTimes: scheduled ? times : undefined,
        startAt: startAt ? new Date(startAt) : undefined,
        userId,
      });
      toast.success(
        scheduled
          ? `Ordered — doses scheduled at ${normaliseTimes(times).map(formatDoseTime).join(', ')}`
          : 'Medication ordered'
      );
      setSearch(''); setSelected(null); setDose('');
      setDoseTouched(false); setRouteTouched(false);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const stop = async (orderId: string) => {
    const reason = prompt('Reason for stopping?') ?? undefined;
    try {
      await medicationService.stopOrder(orderId, reason);
      toast.success('Order stopped');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      {!readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
          <div className="flex flex-wrap gap-2">
            <MedicinePicker
              clinicId={clinicId}
              value={search}
              selected={selected}
              onChange={setSearch}
              onSelect={pickMedicine}
              className="flex-1 min-w-52"
            />
            <input
              value={dose}
              onChange={(e) => { setDose(e.target.value); setDoseTouched(true); }}
              list="med-dose-options"
              placeholder="Dose (500mg)"
              className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            />
            <datalist id="med-dose-options">
              {doseSuggestions(selected).map((d) => <option key={d} value={d} />)}
            </datalist>
            <select value={route} onChange={(e) => { setRoute(e.target.value); setRouteTouched(true); }}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              {ROUTE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={frequency} onChange={(e) => pickFrequency(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              {FREQUENCY_OPTIONS.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
            </select>
            <input type="number" value={days} onChange={(e) => setDays(e.target.value)} min={1} max={14}
              title="Days" className="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
            <button
              onClick={create}
              disabled={saving}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
            >
              <Plus className="w-4 h-4" /> Order
            </button>
          </div>

          {/* The frequency only suggests the clock — the ward order decides it.
              "12 hourly at 8 PM and 8 AM" is set here, not inferred. */}
          {scheduled && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-start gap-x-6 gap-y-2">
              <DoseTimesEditor times={times} onChange={setTimes} />
              <label className="text-xs text-slate-500">
                Start from
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="block mt-0.5 border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
                />
                <span className="block text-slate-400 mt-0.5">First dose is the next listed time from here.</span>
              </label>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {orders.map((o) => (
          <div key={o.id}>
            <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Pill className={`w-4 h-4 shrink-0 ${o.status === 'active' ? 'text-blue-600' : 'text-slate-300'}`} />
              <div className="flex-1 min-w-0">
                <p className={`font-medium ${o.status === 'active' ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                  {o.medicine_name} {o.dose ?? ''}
                </p>
                <p className="text-xs text-slate-400">
                  {o.route ?? ''} · {o.frequency_code.toUpperCase()}
                  {isScheduledFrequency(o.frequency_code) &&
                    ` at ${orderDoseTimes(o).map(formatDoseTime).join(', ')}`}
                  {' · from '}{format(new Date(o.start_at), 'dd MMM')}
                  {o.end_at ? ` to ${format(new Date(o.end_at), 'dd MMM')}` : ''}
                  {o.stopped_reason ? ` — stopped: ${o.stopped_reason}` : ''}
                </p>
              </div>
              <span className="text-xs uppercase text-slate-400">{o.status}</span>
              {o.status === 'active' && !readOnly && isScheduledFrequency(o.frequency_code) && (
                <button
                  onClick={() => setRetimingId(retimingId === o.id ? null : o.id)}
                  title="Change dose times"
                  className="p-1.5 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100"
                >
                  {retimingId === o.id ? <X className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                </button>
              )}
              {o.status === 'active' && !readOnly && (
                <button
                  onClick={() => stop(o.id)}
                  title="Stop order"
                  className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                >
                  <Square className="w-4 h-4" />
                </button>
              )}
            </div>
            {retimingId === o.id && !readOnly && (
              <RetimeRow
                clinicId={clinicId}
                order={o}
                onClose={() => setRetimingId(null)}
                onSaved={() => { setRetimingId(null); onChange(); }}
              />
            )}
          </div>
        ))}
        {orders.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-slate-400">No medication orders yet</div>
        )}
      </div>
    </div>
  );
}

/** <input type="datetime-local"> wants local wall-clock, not an ISO string. */
function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Re-time a running order.
 *
 * Ward reality: an 8 AM / 8 PM antibiotic gets shifted to fit the round, or a
 * course started at the wrong hour. Doses already signed for stay exactly as
 * charted; only the slots still ahead are rebuilt on the new times.
 */
function RetimeRow({
  clinicId, order, onClose, onSaved,
}: {
  clinicId: string; order: MedicationOrder; onClose: () => void; onSaved: () => void;
}) {
  const [times, setTimes] = useState<string[]>(() => orderDoseTimes(order));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (normaliseTimes(times).length === 0) {
      toast.error('Set at least one dose time');
      return;
    }
    setSaving(true);
    try {
      await medicationService.retimeOrder({ clinicId, order, doseTimes: times });
      toast.success('Dose times updated — upcoming doses rescheduled');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-50 border-t border-slate-200 px-4 py-3">
      <DoseTimesEditor times={times} onChange={setTimes} />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={save}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
        >
          {saving ? 'Rescheduling…' : 'Save times'}
        </button>
        <button onClick={onClose} className="text-sm text-slate-500 px-2 py-1.5">Cancel</button>
        <span className="text-xs text-slate-400">Doses already signed for are not touched.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmarSection({
  clinicId, admissionId, schedule, orders, userId, readOnly, onChange,
}: {
  clinicId: string; admissionId: string; schedule: MedicationScheduleSlot[];
  orders: MedicationOrder[]; userId?: string; readOnly: boolean; onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [sourceStoreId, setSourceStoreId] = useState(''); // '' = main pharmacy

  useEffect(() => {
    storeService.listStores(clinicId).then(setStores).catch(() => setStores([]));
  }, [clinicId]);

  const act = async (slot: MedicationScheduleSlot, status: 'given' | 'held' | 'refused') => {
    const order = slot.medication_order ?? orders.find((o) => o.id === slot.medication_order_id);
    if (!order) return;
    let reason: string | undefined;
    if (status !== 'given') {
      reason = prompt(`Reason for ${status}?`) ?? undefined;
      if (!reason) return;
    }
    setBusy(slot.id);
    try {
      await medicationService.administer({
        clinicId, scheduleId: slot.id, admissionId, order, status, reason, userId,
        sourceStoreId: sourceStoreId || undefined,
      });
      toast.success(status === 'given' ? 'Dose recorded, stock deducted' : `Dose ${status}`);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const givePrn = async (order: MedicationOrder) => {
    setBusy(order.id);
    try {
      const slotId = await medicationService.createPrnSlot({
        clinicId, orderId: order.id, admissionId,
      });
      await medicationService.administer({
        clinicId, scheduleId: slotId, admissionId, order, status: 'given', userId,
        sourceStoreId: sourceStoreId || undefined,
      });
      toast.success('PRN dose recorded');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // group slots by calendar day
  const byDay = new Map<string, MedicationScheduleSlot[]>();
  for (const s of schedule) {
    const day = format(new Date(s.scheduled_at), 'yyyy-MM-dd');
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(s);
  }
  const prnOrders = orders.filter((o) => o.status === 'active' && o.frequency_code === 'sos');

  return (
    <div>
      {!readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-2.5 mb-3 flex items-center gap-2 text-sm">
          <span className="text-slate-500">Deduct stock from:</span>
          <select
            value={sourceStoreId}
            onChange={(e) => setSourceStoreId(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="">Main Pharmacy</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span className="text-xs text-slate-400">applies to doses marked given below</span>
        </div>
      )}

      {prnOrders.length > 0 && !readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
          <p className="text-xs text-slate-500 mb-2">PRN / SOS medications — give on demand:</p>
          <div className="flex flex-wrap gap-2">
            {prnOrders.map((o) => (
              <button
                key={o.id}
                onClick={() => givePrn(o)}
                disabled={busy === o.id}
                className="flex items-center gap-1.5 border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <HandMetal className="w-4 h-4 text-blue-600" />
                {o.medicine_name} {o.dose ?? ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {[...byDay.entries()].map(([day, slots]) => (
        <div key={day} className="mb-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">
            {isToday(new Date(day)) ? 'Today' : format(new Date(day), 'EEEE, dd MMM')}
          </h3>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {slots.map((s) => {
              const order = s.medication_order ?? orders.find((o) => o.id === s.medication_order_id);
              const overdue = s.status === 'due' && isPast(new Date(s.scheduled_at));
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className={`w-14 font-mono text-xs ${overdue ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                    {format(new Date(s.scheduled_at), 'HH:mm')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-800">{order?.medicine_name} {order?.dose ?? ''}</span>
                    <span className="text-xs text-slate-400 ml-2">{order?.route ?? ''}</span>
                  </div>
                  {s.status === 'due' && !readOnly ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => act(s, 'given')}
                        disabled={busy === s.id}
                        title="Given"
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => act(s, 'held')}
                        disabled={busy === s.id}
                        title="Hold"
                        className="p-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        <HandMetal className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => act(s, 'refused')}
                        disabled={busy === s.id}
                        title="Refused"
                        className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`text-xs uppercase px-2 py-0.5 rounded ${
                        s.status === 'given' ? 'bg-emerald-100 text-emerald-700'
                        : s.status === 'due' ? 'bg-slate-100 text-slate-500'
                        : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {s.status}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {schedule.length === 0 && prnOrders.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-400">
          No doses scheduled — add a medication order first.
        </div>
      )}
    </div>
  );
}
