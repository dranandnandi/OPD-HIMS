import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FlaskConical, Plus, Send, Trash2, X, Layers, BookmarkPlus } from 'lucide-react';
import { orderService, OrderCategory, OrderSet } from '../../services/orderService';
import { ORDER_STATUS_LABEL, isOpenOrder } from './orderStatus';
import type { Admission, IpdOrderItem, ServiceMaster } from '../../types/ipd';

interface Props {
  clinicId: string;
  admission: Admission;
  userId?: string;
  /** raised from a treatment-plan entry — links the order back to that round */
  treatmentPlanId?: string | null;
  /** what is already on the chart, so the same test isn't ordered (and charged) twice */
  existingItems?: IpdOrderItem[];
  onPlaced: () => void;
  onCancel?: () => void;
  compact?: boolean;
}

const CATEGORIES: Array<{ key: OrderCategory | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pathology', label: 'Pathology' },
  { key: 'radiology', label: 'Radiology' },
  { key: 'procedure', label: 'Procedures' },
];

interface Line { service: ServiceMaster; quantity: number }

/** Place a diagnostics / procedure order — shared by the Orders tab and the
    "order tests" action on a treatment-plan entry. */
export default function OrderComposer({
  clinicId, admission, userId, treatmentPlanId, existingItems, onPlaced, onCancel, compact,
}: Props) {
  const [category, setCategory] = useState<OrderCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<ServiceMaster[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [sets, setSets] = useState<OrderSet[]>([]);

  const loadSets = () =>
    orderService.listOrderSets(clinicId).then(setSets).catch(() => setSets([]));

  useEffect(() => { loadSets(); }, [clinicId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handle = setTimeout(() => {
      if (search.trim().length < 2 && category === 'all') { setOptions([]); return; }
      orderService
        .listOrderableServices(clinicId, category, search.trim() || undefined)
        .then((r) => setOptions(r.slice(0, 20)))
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [clinicId, category, search]);

  /**
   * A test dictated on the round is already ordered and sitting at "awaiting
   * sample" — picking it again here would place a second order and post a
   * second charge, which is what the duplicate chips on the plan card were.
   */
  const openOrders = useMemo(() => {
    const map = new Map<string, IpdOrderItem>();
    for (const i of existingItems ?? []) {
      if (isOpenOrder(i.status) && !map.has(i.service_id)) map.set(i.service_id, i);
    }
    return map;
  }, [existingItems]);

  const addLine = (service: ServiceMaster) => {
    const open = openOrders.get(service.id);
    if (
      open
      && !confirm(
        `${service.name} is already ordered on this admission (${ORDER_STATUS_LABEL[open.status]}).\n\n`
        + 'Order it again? A second charge will be posted.'
      )
    ) {
      setSearch('');
      setOptions([]);
      return;
    }
    setLines((prev) =>
      prev.some((l) => l.service.id === service.id)
        ? prev
        : [...prev, { service, quantity: 1 }]
    );
    setSearch('');
    setOptions([]);
  };

  const applySet = (set: OrderSet) => {
    const additions = (set.items ?? [])
      .filter((i) => i.service)
      .map((i) => ({ service: i.service!, quantity: Number(i.default_qty) || 1 }));
    setLines((prev) => {
      const merged = [...prev];
      for (const a of additions) {
        if (!merged.some((l) => l.service.id === a.service.id)) merged.push(a);
      }
      return merged;
    });
    toast.success(`${set.name} — ${additions.length} item(s) added`);
  };

  const saveAsSet = async () => {
    if (lines.length === 0) return;
    const name = prompt('Name this order set (e.g. "Post-op day 1", "Fever workup")');
    if (!name?.trim()) return;
    try {
      await orderService.createOrderSet({
        clinicId,
        name: name.trim(),
        lines: lines.map((l) => ({ serviceId: l.service.id, quantity: l.quantity })),
        userId,
      });
      toast.success('Order set saved — reusable for any patient');
      loadSets();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const removeSet = async (set: OrderSet) => {
    if (!confirm(`Delete the "${set.name}" order set?`)) return;
    try {
      await orderService.deleteOrderSet(set.id);
      loadSets();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const place = async () => {
    if (lines.length === 0) { toast.error('Add at least one test'); return; }
    if (!userId) { toast.error('Sign-in required to place orders'); return; }
    setPlacing(true);
    try {
      await orderService.placeOrder({
        clinicId,
        admissionId: admission.id,
        orderedBy: userId,
        priority,
        clinicalNotes: notes.trim() || undefined,
        treatmentPlanId: treatmentPlanId ?? null,
        tariffPlanId: admission.tariff_plan_id,
        bedTypeId: admission.current_bed?.bed_type_id ?? null,
        lines: lines.map((l) => ({ serviceId: l.service.id, quantity: l.quantity })),
      });
      toast.success(`Order placed — ${lines.length} item(s), charges posted`);
      setLines([]); setNotes(''); setPriority('routine');
      onPlaced();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlacing(false);
    }
  };

  const total = lines.reduce((s, l) => s + l.service.base_price * l.quantity, 0);

  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-3 ${compact ? '' : 'mb-3'}`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <FlaskConical className="w-4 h-4 text-navy-600" />
        <span className="text-sm font-semibold text-slate-700">Order tests / procedures</span>
        {onCancel && (
          <button onClick={onCancel} className="ml-auto p-1 text-slate-400 hover:text-slate-700" title="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as OrderCategory | 'all')}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
        >
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>

        <div className="relative flex-1 min-w-52">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search test / scan / procedure…"
            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />
          {options.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-56 overflow-auto">
              {options.map((s) => (
                <li
                  key={s.id}
                  onClick={() => addLine(s)}
                  className="px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer flex justify-between gap-2"
                >
                  <span>
                    <span className="font-mono text-xs text-navy-700 bg-slate-100 rounded px-1 py-0.5 mr-1.5">
                      {s.service_code}
                    </span>
                    {s.name}
                    {openOrders.has(s.id) && (
                      <span className="ml-1.5 text-[10px] text-amber-700 bg-amber-100 rounded px-1">
                        already ordered
                      </span>
                    )}
                  </span>
                  <span className="text-slate-400 whitespace-nowrap text-xs">
                    {s.service_type} · ₹{s.base_price}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          title="Priority"
        >
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="stat">STAT</option>
        </select>
      </div>

      {sets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Layers className="w-3.5 h-3.5" /> Order sets:
          </span>
          {sets.map((s) => (
            <span
              key={s.id}
              className="flex items-center border border-slate-300 rounded-lg overflow-hidden text-xs"
            >
              <button
                onClick={() => applySet(s)}
                className="px-2 py-1 text-slate-600 hover:bg-slate-50"
                title={(s.items ?? []).map((i) => i.service?.name).filter(Boolean).join(', ')}
              >
                {s.name}
                <span className="text-slate-400"> ({s.items?.length ?? 0})</span>
              </button>
              <button
                onClick={() => removeSet(s)}
                className="px-1.5 py-1 text-slate-300 hover:text-red-600 hover:bg-red-50 border-l border-slate-200"
                title="Delete this set"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <div className="mt-2 border border-slate-100 rounded-lg divide-y divide-slate-100">
          {lines.map((l, i) => (
            <div key={l.service.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <span className="flex-1 text-slate-700">
                <span className="font-mono text-xs text-slate-400 mr-1.5">{l.service.service_code}</span>
                {l.service.name}
                {openOrders.has(l.service.id) && (
                  <span className="ml-1.5 text-[10px] text-amber-700 bg-amber-100 rounded px-1">
                    repeat — already open on this admission
                  </span>
                )}
              </span>
              <input
                type="number"
                min={1}
                value={l.quantity}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((x, xi) => (xi === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))
                  )
                }
                className="w-14 border border-slate-300 rounded px-1.5 py-1 text-sm"
                title="Qty"
              />
              <span className="w-20 text-right text-slate-600">
                ₹{(l.service.base_price * l.quantity).toFixed(2)}
              </span>
              <button
                onClick={() => setLines((prev) => prev.filter((_, xi) => xi !== i))}
                className="p-1 text-slate-400 hover:text-red-600"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="px-2.5 py-1.5 text-sm flex justify-between bg-slate-50">
            <span className="text-slate-500">Estimated (catalog rate — tariff applies on posting)</span>
            <span className="font-semibold text-slate-700">₹{total.toFixed(2)}</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Clinical notes / instructions (fasting, timing)…"
          className="flex-1 min-w-52 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
        />
        {lines.length > 0 && (
          <button
            onClick={saveAsSet}
            title="Save these lines as a reusable order set"
            className="flex items-center gap-1.5 border border-slate-300 text-slate-600 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50"
          >
            <BookmarkPlus className="w-4 h-4" /> Save as set
          </button>
        )}
        <button
          onClick={place}
          disabled={placing || lines.length === 0}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
        >
          {placing ? <Plus className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {placing ? 'Placing…' : 'Place order'}
        </button>
      </div>
      <p className="text-xs text-slate-400 mt-1">
        Placing an order posts its charge to the running bill straight away.
      </p>
    </div>
  );
}
