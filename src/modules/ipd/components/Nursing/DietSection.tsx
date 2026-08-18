import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { UtensilsCrossed, Check, Ban, MinusCircle, Pencil, History, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  dietService, DIET_TYPES, DIET_ROUTES, MEAL_SLOTS, DietOrderInput,
} from '../../services/dietService';
import { documentService } from '../../services/documentService';
import type {
  Admission, DietChartEntry, DietOrder, DietRoute, DietType, MealSlot,
} from '../../types/ipd';

interface Props {
  admission: Admission;
  readOnly: boolean;
}

const STATUS_STYLE: Record<DietChartEntry['status'], string> = {
  planned: 'bg-slate-50 text-slate-500 border-slate-200',
  served: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  refused: 'bg-amber-50 text-amber-700 border-amber-200',
  withheld: 'bg-red-50 text-red-700 border-red-200',
};

/** Diet chart — the standing diet order plus the meal-wise record the ward
    ticks off. Kept under Nursing; the doctor sets the diet from the plan. */
export default function DietSection({ admission, readOnly }: Props) {
  const admissionId = admission.id;
  const { clinicId, profile } = useAuth();
  const [orders, setOrders] = useState<DietOrder[]>([]);
  const [entries, setEntries] = useState<DietChartEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chartDate, setChartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [form, setForm] = useState<DietOrderInput>({
    dietType: 'normal',
    route: 'oral',
    caloriesKcal: null,
    proteinG: null,
    fluidRestrictionMl: null,
    specialInstructions: '',
    restrictions: '',
  });

  const reload = useCallback(() => {
    Promise.all([dietService.listOrders(admissionId), dietService.listEntries(admissionId, 7)])
      .then(([o, e]) => { setOrders(o); setEntries(e); })
      .catch((e) => toast.error(e.message));
  }, [admissionId]);

  useEffect(reload, [reload]);

  const active = orders.find((o) => o.status === 'active') ?? null;

  const startEdit = () => {
    setForm(
      active
        ? {
          dietType: active.diet_type,
          route: active.route,
          caloriesKcal: active.calories_kcal,
          proteinG: active.protein_g,
          fluidRestrictionMl: active.fluid_restriction_ml,
          specialInstructions: active.special_instructions ?? '',
          restrictions: active.restrictions ?? '',
        }
        : form
    );
    setEditing(true);
  };

  const saveOrder = async () => {
    if (!clinicId) return;
    setSaving(true);
    try {
      await dietService.setOrder({ clinicId, admissionId, input: form, userId: profile?.id });
      toast.success('Diet order updated — kitchen chart refreshed');
      setEditing(false);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const stop = async () => {
    if (!active) return;
    const reason = prompt('Stop the diet order — reason?');
    if (reason === null) return;
    try {
      await dietService.stopOrder(active.id, reason || 'Stopped');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const record = async (
    meal: MealSlot,
    status: DietChartEntry['status'],
    existing?: DietChartEntry
  ) => {
    if (!clinicId) return;
    const intakeRaw = status === 'served'
      ? prompt(`Intake for ${meal.replace('_', ' ')} (% of the meal, blank to skip)`, existing?.intake_percent?.toString() ?? '')
      : null;
    if (status === 'served' && intakeRaw === null) return;
    try {
      await dietService.recordMeal({
        clinicId,
        admissionId,
        dietOrderId: active?.id ?? null,
        entryDate: chartDate,
        meal,
        items: existing?.items ?? null,
        status,
        intakePercent: intakeRaw ? Math.max(0, Math.min(100, Number(intakeRaw))) : null,
        userId: profile?.id,
      });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const dayEntries = entries.filter((e) => e.entry_date === chartDate);
  const entryFor = (meal: MealSlot) => dayEntries.find((e) => e.meal === meal);

  const recentDates = [...new Set(entries.map((e) => e.entry_date))]
    .filter((d) => d !== chartDate)
    .slice(0, 6);

  return (
    <div className="space-y-3">
      {/* Standing diet order */}
      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <UtensilsCrossed className="w-4 h-4 text-lime-600" />
          <span className="text-sm font-semibold text-slate-800">Diet order</span>
          {active ? (
            <span className="text-xs bg-lime-100 text-lime-800 rounded-full px-2 py-0.5">
              active since {format(new Date(active.start_date), 'dd MMM')}
            </span>
          ) : (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              no diet ordered
            </span>
          )}
          {!readOnly && (
            <span className="ml-auto flex gap-1.5">
              <button
                onClick={startEdit}
                className="flex items-center gap-1 text-xs border border-slate-300 text-slate-600 rounded-lg px-2 py-1 hover:bg-slate-50"
              >
                <Pencil className="w-3.5 h-3.5" /> {active ? 'Change diet' : 'Set diet'}
              </button>
              {active && (
                <button
                  onClick={stop}
                  className="flex items-center gap-1 text-xs border border-slate-300 text-slate-500 rounded-lg px-2 py-1 hover:bg-red-50 hover:text-red-600"
                >
                  <MinusCircle className="w-3.5 h-3.5" /> Stop
                </button>
              )}
            </span>
          )}
        </div>

        {editing && !readOnly ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <select
                value={form.dietType}
                onChange={(e) => setForm({ ...form, dietType: e.target.value as DietType })}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              >
                {DIET_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <select
                value={form.route}
                onChange={(e) => setForm({ ...form, route: e.target.value as DietRoute })}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              >
                {DIET_ROUTES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <input
                type="number" min={0}
                value={form.caloriesKcal ?? ''}
                onChange={(e) => setForm({ ...form, caloriesKcal: e.target.value ? Number(e.target.value) : null })}
                placeholder="kcal/day"
                className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <input
                type="number" min={0}
                value={form.proteinG ?? ''}
                onChange={(e) => setForm({ ...form, proteinG: e.target.value ? Number(e.target.value) : null })}
                placeholder="protein g"
                className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <input
                type="number" min={0}
                value={form.fluidRestrictionMl ?? ''}
                onChange={(e) => setForm({ ...form, fluidRestrictionMl: e.target.value ? Number(e.target.value) : null })}
                placeholder="fluids ml/day"
                className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              />
            </div>
            <input
              value={form.specialInstructions ?? ''}
              onChange={(e) => setForm({ ...form, specialInstructions: e.target.value })}
              placeholder="Special instructions to the kitchen / ward (small frequent feeds, no added sugar…)"
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
            <input
              value={form.restrictions ?? ''}
              onChange={(e) => setForm({ ...form, restrictions: e.target.value })}
              placeholder="Avoid / allergies (no groundnut, no citrus…)"
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5">
                Cancel
              </button>
              <button
                onClick={saveOrder}
                disabled={saving}
                className="bg-lime-600 hover:bg-lime-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
              >
                {saving ? 'Saving…' : 'Save diet order'}
              </button>
            </div>
          </div>
        ) : active ? (
          <div className="text-sm text-slate-600 space-y-0.5">
            <p>
              <b className="text-slate-800">
                {DIET_TYPES.find((d) => d.key === active.diet_type)?.label ?? active.diet_type}
              </b>{' '}
              · {DIET_ROUTES.find((r) => r.key === active.route)?.label ?? active.route}
              {active.calories_kcal ? ` · ${active.calories_kcal} kcal/day` : ''}
              {active.protein_g ? ` · ${active.protein_g} g protein` : ''}
              {active.fluid_restriction_ml ? ` · fluids ${active.fluid_restriction_ml} ml/day` : ''}
            </p>
            {active.special_instructions && <p>{active.special_instructions}</p>}
            {active.restrictions && <p className="text-red-600">Avoid: {active.restrictions}</p>}
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            Set the diet so the ward and kitchen chart show what this patient may have.
          </p>
        )}
      </div>

      {/* Meal-wise chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-sm font-semibold text-slate-800">Meal chart</span>
          <input
            type="date"
            value={chartDate}
            onChange={(e) => setChartDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
          />
          <button
            onClick={() =>
              documentService.printDietChart({
                admission,
                clinicId: clinicId!,
                order: active,
                entries: dayEntries,
                date: chartDate,
              })
            }
            title="Print the kitchen / ward copy for this date"
            className="flex items-center gap-1 text-xs border border-slate-300 text-slate-600 rounded-lg px-2 py-1 hover:bg-slate-50"
          >
            <Printer className="w-3.5 h-3.5" /> Print chart
          </button>
          {recentDates.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <History className="w-3.5 h-3.5" />
              {recentDates.map((d) => (
                <button
                  key={d}
                  onClick={() => setChartDate(d)}
                  className="border border-slate-200 rounded px-1.5 py-0.5 hover:bg-slate-50"
                >
                  {format(new Date(d), 'dd MMM')}
                </button>
              ))}
            </span>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MEAL_SLOTS.map((slot) => {
            const e = entryFor(slot.key);
            const status = e?.status ?? 'planned';
            return (
              <div key={slot.key} className={`rounded-lg border p-2.5 text-sm ${STATUS_STYLE[status]}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{slot.label}</span>
                  <span className="text-xs text-slate-400">{slot.time}</span>
                </div>
                <p className="text-xs mt-0.5 capitalize">
                  {status}
                  {e?.intake_percent != null ? ` · intake ${e.intake_percent}%` : ''}
                  {e?.served_at ? ` · ${format(new Date(e.served_at), 'HH:mm')}` : ''}
                </p>
                {!readOnly && (
                  <div className="flex gap-1 mt-1.5">
                    <button
                      onClick={() => record(slot.key, 'served', e)}
                      title="Served"
                      className="p-1 rounded bg-white/70 border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => record(slot.key, 'refused', e)}
                      title="Patient refused"
                      className="p-1 rounded bg-white/70 border border-amber-200 text-amber-700 hover:bg-amber-50"
                    >
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => record(slot.key, 'withheld', e)}
                      title="Withheld (NPO / procedure)"
                      className="p-1 rounded bg-white/70 border border-red-200 text-red-700 hover:bg-red-50"
                    >
                      <MinusCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Diet order history */}
      {orders.length > 1 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-700 mb-2">Diet order history</p>
          <div className="space-y-1 text-sm">
            {orders.filter((o) => o.status !== 'active').map((o) => (
              <p key={o.id} className="text-slate-500">
                {format(new Date(o.start_date), 'dd MMM')}
                {o.end_date ? ` → ${format(new Date(o.end_date), 'dd MMM')}` : ''} ·{' '}
                {DIET_TYPES.find((d) => d.key === o.diet_type)?.label ?? o.diet_type} ({o.route})
                {o.stopped_reason ? ` · ${o.stopped_reason}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
