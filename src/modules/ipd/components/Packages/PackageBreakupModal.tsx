import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Printer, RefreshCw, Trash2, X } from 'lucide-react';
import {
  packageService, AdmissionPackage, PackageBreakupLine,
} from '../../services/packageService';
import { chargeService } from '../../services/chargeService';
import { documentService } from '../../services/documentService';
import type { Admission, ChargeGroup, ServiceMaster } from '../../types/ipd';

/**
 * The claim annexure for one admission's package.
 *
 * Components are listed at tariff; the residual head always holds
 * agreed price − everything else and is recomputed in the database on every
 * change, so the break-up totals the package price by construction. The
 * patient's own bill is untouched — it still shows one package line.
 */
export default function PackageBreakupModal({
  clinicId, assignment, admission, onClose,
}: {
  clinicId: string;
  assignment: AdmissionPackage;
  admission: Admission;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<PackageBreakupLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // add-component form. Heads are the default: several of them
  // (Investigations, OT Charges) are groups with no service to point at.
  const [target, setTarget] = useState<'group' | 'service'>('group');
  const [groups, setGroups] = useState<ChargeGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<ServiceMaster[]>([]);
  const [svc, setSvc] = useState<ServiceMaster | null>(null);
  const [qty, setQty] = useState('1');
  const [rate, setRate] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    packageService
      .listBreakupLines(assignment.id)
      .then(setLines)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [assignment.id]);

  useEffect(reload, [reload]);

  useEffect(() => {
    chargeService.listChargeGroups(clinicId).then(setGroups).catch(() => setGroups([]));
  }, [clinicId]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (search.trim().length < 1 || svc) { setOptions([]); return; }
      chargeService.listServices(clinicId, search).then(setOptions).catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [clinicId, search, svc]);

  const components = lines.filter((l) => !l.is_residual);
  const residualLine = lines.find((l) => l.is_residual) ?? null;
  const componentsTotal = components.reduce((s, l) => s + Number(l.net), 0);
  const total = componentsTotal + Number(residualLine?.net ?? 0);
  const negativeResidual = Number(residualLine?.net ?? 0) < 0;

  const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const build = () =>
    run(() => packageService.generateBreakup(assignment.id), 'Break-up built from covered charges');

  const addComponent = () => {
    const group = groups.find((g) => g.id === groupId);
    if (target === 'group' && !group) { toast.error('Pick a charge head'); return; }
    if (target === 'service' && !svc) { toast.error('Pick a service'); return; }
    const q = Number(qty) || 1;
    const r = Number(rate);
    if (!r || r <= 0) { toast.error('Enter a rate'); return; }
    return run(async () => {
      await packageService.addBreakupLine({
        clinic_id: clinicId,
        assignment_id: assignment.id,
        service_id: target === 'service' ? svc!.id : undefined,
        charge_group_id: target === 'group' ? group!.id : undefined,
        description: target === 'service' ? svc!.name : group!.name,
        quantity: q,
        unit_rate: r,
      });
      setSvc(null); setSearch(''); setGroupId(''); setQty('1'); setRate('');
    });
  };

  const print = () => {
    if (negativeResidual) {
      toast.error('Components exceed the package price — fix the residual before printing');
      return;
    }
    documentService
      .printPackageBreakup({
        lines: lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unit_rate: Number(l.unit_rate),
          net: Number(l.net),
          is_residual: l.is_residual,
        })),
        packageName: assignment.package?.name ?? 'Package',
        agreedPrice: assignment.agreed_price,
        admission,
        clinicId,
      })
      .catch((e) => toast.error((e as Error).message));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl my-8 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Package break-up — claim annexure</h2>
            <p className="text-xs text-slate-400">
              {assignment.package?.name} · agreed {inr(assignment.agreed_price)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={build}
              disabled={busy}
              className="text-sm border border-navy-300 text-navy-700 rounded-lg px-3 py-1.5 hover:bg-navy-50 disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4" />
              {lines.length ? 'Rebuild from covered charges' : 'Build break-up'}
            </button>
            <button
              onClick={print}
              disabled={busy || lines.length === 0}
              className="text-sm border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" /> Print annexure
            </button>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No break-up yet. Build one from the charges this package absorbed, or add heads below.
            </p>
          ) : (
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2">Head</th>
                  <th className="py-2 text-right w-20">Qty</th>
                  <th className="py-2 text-right w-28">Rate</th>
                  <th className="py-2 text-right w-28">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {components.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-1.5">{l.description}</td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        defaultValue={l.quantity}
                        onBlur={(e) => {
                          const q = Number(e.target.value);
                          if (!q || q === Number(l.quantity)) return;
                          run(() => packageService.updateBreakupLine(l.id, { quantity: q, unit_rate: Number(l.unit_rate) }));
                        }}
                        className="w-16 text-right border border-slate-200 rounded px-1.5 py-0.5"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        defaultValue={l.unit_rate}
                        onBlur={(e) => {
                          const r = Number(e.target.value);
                          if (r === Number(l.unit_rate)) return;
                          run(() => packageService.updateBreakupLine(l.id, { quantity: Number(l.quantity), unit_rate: r }));
                        }}
                        className="w-24 text-right border border-slate-200 rounded px-1.5 py-0.5"
                      />
                    </td>
                    <td className="py-1.5 text-right">{inr(l.net)}</td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => run(() => packageService.removeBreakupLine(l.id))}
                        className="p-1 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}

                {residualLine && (
                  <tr className={`border-b border-slate-200 ${negativeResidual ? 'text-red-600' : 'text-slate-700'}`}>
                    <td className="py-1.5">
                      <input
                        defaultValue={residualLine.description}
                        onBlur={(e) => {
                          const name = e.target.value.trim();
                          if (!name || name === residualLine.description) return;
                          run(() => packageService.renameBreakupLine(residualLine.id, name));
                        }}
                        title="What this line prints as on the annexure — the amount stays derived"
                        className="w-56 italic border border-transparent hover:border-slate-200 focus:border-slate-300 rounded px-1.5 py-0.5"
                      />
                      <span className="text-xs text-slate-400 ml-1">
                        (residual — recalculates itself)
                      </span>
                    </td>
                    <td className="py-1.5 text-right">1</td>
                    <td className="py-1.5 text-right">{inr(residualLine.unit_rate)}</td>
                    <td className="py-1.5 text-right font-medium">{inr(residualLine.net)}</td>
                    <td />
                  </tr>
                )}

                <tr className="font-semibold text-slate-800">
                  <td className="py-2" colSpan={3}>Break-up total</td>
                  <td className="py-2 text-right">{inr(total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}

          {negativeResidual && (
            <p className="mb-3 text-xs text-red-600">
              Components exceed the package price by {inr(Math.abs(Number(residualLine?.net ?? 0)))}.
              Reduce a head, or renegotiate the agreed price — the annexure cannot be printed while
              the residual is negative.
            </p>
          )}

          {/* add a head */}
          <div className="flex flex-wrap gap-2 items-center border-t border-slate-100 pt-3">
            <select
              value={target}
              onChange={(e) => { setTarget(e.target.value as typeof target); setSvc(null); setSearch(''); setGroupId(''); }}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            >
              <option value="group">Charge head</option>
              <option value="service">Specific service</option>
            </select>

            {target === 'group' ? (
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-44"
              >
                <option value="">Pick a charge head…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {' '.repeat((g.depth - 1) * 3)}{g.code} — {g.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="relative flex-1 min-w-44">
                <input
                  value={svc ? `${svc.service_code} — ${svc.name}` : search}
                  onChange={(e) => { setSearch(e.target.value); setSvc(null); }}
                  placeholder="Search service (surgeon fee, oxygen…)"
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
                />
                {options.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-44 overflow-auto">
                    {options.map((s) => (
                      <li
                        key={s.id}
                        onClick={() => { setSvc(s); setOptions([]); setRate(String(s.base_price)); }}
                        className="px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer"
                      >
                        {s.service_code} — {s.name}
                      </li>
                    ))}
                  </ul>
                )}
                {!svc && search.trim().length > 0 && options.length === 0 && (
                  <p className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow px-3 py-1.5 text-xs text-slate-400">
                    No service matches "{search.trim()}" — try <b>Charge head</b> instead.
                  </p>
                )}
              </div>
            )}
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)}
              placeholder="Qty" className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
            <input type="number" value={rate} onChange={(e) => setRate(e.target.value)}
              placeholder="Rate ₹" className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
            <button
              onClick={addComponent}
              disabled={busy}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Adding or editing a head immediately rebalances the residual, so the break-up always
            totals {inr(assignment.agreed_price)}.
          </p>
        </div>
      </div>
    </div>
  );
}
