import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Package as PackageIcon } from 'lucide-react';
import {
  packageService, HospitalPackage, PackageItem, PackageClassPrice,
  CapMode, PackageBreakupRule,
} from '../../services/packageService';
import { chargeService } from '../../services/chargeService';
import { bedService } from '../../services/bedService';
import { masterService } from '../../services/masterService';
import type { ServiceMaster, ChargeGroup, BedType, Payer } from '../../types/ipd';

interface Props {
  clinicId: string;
}

export default function PackagesTab({ clinicId }: Props) {
  const [packages, setPackages] = useState<HospitalPackage[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [selected, setSelected] = useState<HospitalPackage | null>(null);

  const reload = useCallback(() => {
    packageService.listPackages(clinicId, false).then(setPackages).catch((e) => toast.error(e.message));
    masterService.listPayers(clinicId).then(setPayers).catch(() => setPayers([]));
  }, [clinicId]);

  useEffect(reload, [reload]);

  const payerName = (id: string | null) => payers.find((p) => p.id === id)?.name;

  if (selected) {
    return (
      <PackageDetail
        clinicId={clinicId}
        pkg={selected}
        payers={payers}
        onBack={() => { setSelected(null); reload(); }}
      />
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <CreatePackageCard clinicId={clinicId} payers={payers} onCreated={reload} />
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Packages ({packages.length})</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {packages.map((p) => (
            <li
              key={p.id}
              onClick={() => setSelected(p)}
              className="py-2.5 flex items-center gap-3 cursor-pointer hover:bg-slate-50 rounded px-2"
            >
              <PackageIcon className="w-4 h-4 text-navy-600" />
              <div className="flex-1">
                <p className="font-medium text-slate-800">
                  {p.name}
                  {p.exclusive_payer_id && (
                    <span className="ml-2 text-xs font-normal bg-violet-100 text-violet-700 rounded px-1.5 py-0.5">
                      {payerName(p.exclusive_payer_id) ?? 'payer'} only
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400">
                  {p.default_stay_days ? `${p.default_stay_days} days · ` : ''}
                  {p.per_day_bed_cap ? `bed cap ₹${p.per_day_bed_cap}/day · ` : ''}
                  {p.implant_cap ? `implant cap ₹${p.implant_cap}` : ''}
                </p>
              </div>
              <span className="font-semibold text-navy-700">₹{p.package_price.toLocaleString('en-IN')}</span>
            </li>
          ))}
          {packages.length === 0 && (
            <li className="py-6 text-center text-slate-400">No packages yet — create one (e.g. LSCS, TKR, Appendectomy)</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CreatePackageCard({
  clinicId, payers, onCreated,
}: {
  clinicId: string; payers: Payer[]; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [estCost, setEstCost] = useState('');
  const [stayDays, setStayDays] = useState('');
  const [bedCap, setBedCap] = useState('');
  const [implantCap, setImplantCap] = useState('');
  const [buffer, setBuffer] = useState('');
  const [exclusivePayerId, setExclusivePayerId] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim() || !price) {
      toast.error('Name and price are required');
      return;
    }
    setSaving(true);
    try {
      await packageService.createPackage({
        clinic_id: clinicId,
        name: name.trim(),
        package_price: Number(price),
        estimated_cost: estCost ? Number(estCost) : undefined,
        default_stay_days: stayDays ? Number(stayDays) : undefined,
        per_day_bed_cap: bedCap ? Number(bedCap) : undefined,
        implant_cap: implantCap ? Number(implantCap) : undefined,
        deduction_buffer_pct: buffer ? Number(buffer) : 0,
        exclusive_payer_id: exclusivePayerId || null,
      });
      toast.success('Package created — now add inclusions/exclusions');
      setName(''); setPrice(''); setEstCost(''); setStayDays(''); setBedCap(''); setImplantCap(''); setBuffer('');
      setExclusivePayerId('');
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-medium text-slate-700 mb-3">New package</h2>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (LSCS Package) *"
          className="col-span-2 border border-slate-300 rounded-lg px-3 py-1.5" />
        <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Package price ₹ *"
          className="border border-slate-300 rounded-lg px-3 py-1.5" />
        <input type="number" value={estCost} onChange={(e) => setEstCost(e.target.value)} placeholder="Estimated cost ₹"
          className="border border-slate-300 rounded-lg px-3 py-1.5" />
        <input type="number" value={stayDays} onChange={(e) => setStayDays(e.target.value)} placeholder="Stay days"
          className="border border-slate-300 rounded-lg px-3 py-1.5" />
        <input type="number" value={bedCap} onChange={(e) => setBedCap(e.target.value)} placeholder="Bed cap ₹/day"
          className="border border-slate-300 rounded-lg px-3 py-1.5" />
        <input type="number" value={implantCap} onChange={(e) => setImplantCap(e.target.value)} placeholder="Implant cap ₹"
          className="border border-slate-300 rounded-lg px-3 py-1.5" />
        <input type="number" value={buffer} onChange={(e) => setBuffer(e.target.value)} placeholder="Deduction buffer %"
          className="border border-slate-300 rounded-lg px-3 py-1.5" />
        <select
          value={exclusivePayerId}
          onChange={(e) => setExclusivePayerId(e.target.value)}
          title="Restrict this package to one account's patients (e.g. ABPMJAY HBP packages)"
          className="col-span-2 border border-slate-300 rounded-lg px-2 py-1.5"
        >
          <option value="">Available to all payers</option>
          {payers.map((p) => (
            <option key={p.id} value={p.id}>Exclusive to {p.name}</option>
          ))}
        </select>
      </div>
      <button
        onClick={create}
        disabled={saving}
        className="mt-3 flex items-center gap-1 bg-navy-700 hover:bg-navy-800 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
      >
        <Plus className="w-4 h-4" /> {saving ? 'Creating…' : 'Create package'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PackageDetail({
  clinicId, pkg, payers, onBack,
}: {
  clinicId: string; pkg: HospitalPackage; payers: Payer[]; onBack: () => void;
}) {
  const [exclusivePayerId, setExclusivePayerId] = useState(pkg.exclusive_payer_id ?? '');

  const changeExclusivity = async (value: string) => {
    setExclusivePayerId(value);
    try {
      await packageService.updatePackage(pkg.id, { exclusive_payer_id: value || null });
      toast.success(value ? 'Package restricted to the selected account' : 'Package open to all payers');
    } catch (e) {
      toast.error((e as Error).message);
      setExclusivePayerId(pkg.exclusive_payer_id ?? '');
    }
  };

  const [defaultCapMode, setDefaultCapMode] = useState<CapMode>(pkg.default_cap_mode ?? 'split');

  const changeDefaultCapMode = async (mode: CapMode) => {
    const previous = defaultCapMode;
    setDefaultCapMode(mode);
    try {
      await packageService.updatePackage(pkg.id, { default_cap_mode: mode });
      toast.success('Default applied to rules that have no explicit choice');
    } catch (e) {
      toast.error((e as Error).message);
      setDefaultCapMode(previous);
    }
  };

  const [items, setItems] = useState<PackageItem[]>([]);
  const [groups, setGroups] = useState<ChargeGroup[]>([]);
  const [bedTypes, setBedTypes] = useState<BedType[]>([]);
  // add-item form
  const [kind, setKind] = useState<'inclusion' | 'exclusion'>('inclusion');
  const [grain, setGrain] = useState<'group' | 'service'>('group');
  const [groupId, setGroupId] = useState('');
  const [bedTypeId, setBedTypeId] = useState(''); // '' = all bed classes
  const [svcSearch, setSvcSearch] = useState('');
  const [svcOptions, setSvcOptions] = useState<ServiceMaster[]>([]);
  const [svc, setSvc] = useState<ServiceMaster | null>(null);
  const [maxQty, setMaxQty] = useState('');
  const [maxAmt, setMaxAmt] = useState('');
  const [capMode, setCapMode] = useState<CapMode>(pkg.default_cap_mode ?? 'split');

  const reload = useCallback(() => {
    packageService.listItems(pkg.id).then(setItems).catch((e) => toast.error(e.message));
  }, [pkg.id]);

  useEffect(() => {
    reload();
    chargeService.listChargeGroups(clinicId).then(setGroups).catch(() => setGroups([]));
    bedService.listBedTypes(clinicId).then(setBedTypes).catch(() => setBedTypes([]));
  }, [reload, clinicId]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (grain !== 'service' || svcSearch.trim().length < 2 || svc) { setSvcOptions([]); return; }
      chargeService.listServices(clinicId, svcSearch).then(setSvcOptions).catch(() => setSvcOptions([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [clinicId, svcSearch, grain, svc]);

  const addItem = async () => {
    if (grain === 'group' && !groupId) { toast.error('Pick a charge group'); return; }
    if (grain === 'service' && !svc) { toast.error('Pick a service'); return; }
    try {
      await packageService.addItem({
        clinic_id: clinicId,
        package_id: pkg.id,
        item_kind: kind,
        service_id: grain === 'service' ? svc!.id : undefined,
        charge_group_id: grain === 'group' ? groupId : undefined,
        bed_type_id: bedTypeId || undefined,
        max_quantity: kind === 'inclusion' && maxQty ? Number(maxQty) : undefined,
        max_amount: kind === 'inclusion' && maxAmt ? Number(maxAmt) : undefined,
        cap_mode: kind === 'inclusion' && (maxQty || maxAmt) ? capMode : undefined,
      });
      toast.success(`${kind} added`);
      setSvc(null); setSvcSearch(''); setGroupId(''); setBedTypeId(''); setMaxQty(''); setMaxAmt('');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await packageService.removeItem(id);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const changeCapMode = async (id: string, mode: CapMode) => {
    try {
      await packageService.setItemCapMode(id, mode);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const inclusions = items.filter((i) => i.item_kind === 'inclusion');
  const exclusions = items.filter((i) => i.item_kind === 'exclusion');

  const itemLabel = (i: PackageItem) =>
    i.service
      ? `${i.service.service_code} — ${i.service.name}`
      : `${i.charge_group?.code} — ${i.charge_group?.name} (whole group)`;

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5">
          ← Back
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-800">{pkg.name}</h2>
          <p className="text-xs text-slate-400">
            ₹{pkg.package_price.toLocaleString('en-IN')}
            {pkg.estimated_cost ? ` · est. cost ₹${pkg.estimated_cost.toLocaleString('en-IN')}` : ''}
            {pkg.per_day_bed_cap ? ` · bed cap ₹${pkg.per_day_bed_cap}/day` : ''}
            {pkg.implant_cap ? ` · implant cap ₹${pkg.implant_cap}` : ''}
          </p>
        </div>
        <label className="text-xs text-slate-500 flex items-center gap-2">
          Availability
          <select
            value={exclusivePayerId}
            onChange={(e) => changeExclusivity(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="">All payers</option>
            {payers.map((p) => (
              <option key={p.id} value={p.id}>Exclusive to {p.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Add item */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap gap-2 items-center">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="inclusion">Include</option>
          <option value="exclusion">Exclude</option>
        </select>
        <select value={grain} onChange={(e) => { setGrain(e.target.value as typeof grain); setSvc(null); }}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="group">Charge group</option>
          <option value="service">Specific service</option>
        </select>
        {grain === 'group' ? (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-44">
            <option value="">Pick group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{' '.repeat((g.depth - 1) * 3)}{g.code} — {g.name}</option>
            ))}
          </select>
        ) : (
          <div className="relative flex-1 min-w-44">
            <input
              value={svc ? `${svc.service_code} — ${svc.name}` : svcSearch}
              onChange={(e) => { setSvcSearch(e.target.value); setSvc(null); }}
              placeholder="Search service…"
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
            {svcOptions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-44 overflow-auto">
                {svcOptions.map((s) => (
                  <li key={s.id} onClick={() => { setSvc(s); setSvcOptions([]); }}
                    className="px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                    {s.service_code} — {s.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <select
          value={bedTypeId}
          onChange={(e) => setBedTypeId(e.target.value)}
          title="Bed class this rule applies to"
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
        >
          <option value="">All bed classes</option>
          {bedTypes.map((bt) => (
            <option key={bt.id} value={bt.id}>{bt.name} only</option>
          ))}
        </select>
        {kind === 'inclusion' && (
          <>
            <input type="number" value={maxQty} onChange={(e) => setMaxQty(e.target.value)}
              placeholder="Max qty" className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
            <input type="number" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)}
              placeholder="Max ₹" className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </>
        )}
        {kind === 'inclusion' && (maxQty || maxAmt) && (
          <div className="flex items-center gap-3 text-xs text-slate-600 border-l border-slate-200 pl-3">
            <span className="text-slate-400">When the limit is crossed</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" checked={capMode === 'split'} onChange={() => setCapMode('split')} />
              Split at limit
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" checked={capMode === 'block'} onChange={() => setCapMode('block')} />
              Exclude whole charge
            </label>
          </div>
        )}
        <button onClick={addItem} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <ItemList
          title="Inclusions (covered by package price)" items={inclusions} onRemove={remove}
          accent="emerald" itemLabel={itemLabel}
          defaultCapMode={defaultCapMode} onCapMode={changeCapMode}
        />
        <ItemList title="Exclusions (always billed separately)" items={exclusions} onRemove={remove} accent="red" itemLabel={itemLabel} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h3 className="text-sm font-medium text-slate-700 mb-1">Default when a limit is crossed</h3>
        <p className="text-xs text-slate-400 mb-3">
          Applies to capped rules that have no explicit choice of their own. With a ₹2,000 limit,
          ₹1,500 already used and a ₹6,000 charge arriving:{' '}
          <b>split</b> puts ₹500 inside the package and bills ₹5,500;{' '}
          <b>exclude</b> bills the whole ₹6,000 and leaves the ₹500 allowance unused.
        </p>
        <div className="flex gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={defaultCapMode === 'split'} onChange={() => changeDefaultCapMode('split')} />
            Split at limit
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={defaultCapMode === 'block'} onChange={() => changeDefaultCapMode('block')} />
            Exclude whole charge
          </label>
        </div>
      </div>

      <BreakupTemplateCard clinicId={clinicId} pkg={pkg} />

      <ClassPricesCard clinicId={clinicId} pkg={pkg} bedTypes={bedTypes} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Claim break-up template. Leave it empty and a break-up is built from the
 * charges the package actually absorbed. Either way the residual head takes
 * package price − everything else, so the annexure always totals the price.
 */
function BreakupTemplateCard({ clinicId, pkg }: { clinicId: string; pkg: HospitalPackage }) {
  const [rules, setRules] = useState<PackageBreakupRule[]>([]);
  const [residualHead, setResidualHead] = useState<{ id: string; name: string } | null>(null);
  const [grain, setGrain] = useState<'charge_group' | 'service'>(pkg.breakup_grain ?? 'charge_group');
  // What the "add" row targets. Heads are the default: most of them
  // (Investigations, OT Charges) are groups with no service to point at.
  const [target, setTarget] = useState<'group' | 'service'>('group');
  const [groups, setGroups] = useState<ChargeGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<ServiceMaster[]>([]);
  const [svc, setSvc] = useState<ServiceMaster | null>(null);
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [residualSearch, setResidualSearch] = useState('');
  const [residualOptions, setResidualOptions] = useState<ServiceMaster[]>([]);
  const [editingResidual, setEditingResidual] = useState(false);
  const [residualLabel, setResidualLabel] = useState(pkg.residual_label ?? '');

  const reload = useCallback(() => {
    packageService.listBreakupRules(pkg.id).then(setRules).catch((e) => toast.error(e.message));
    packageService.getResidualHead(clinicId, pkg).then(setResidualHead).catch(() => setResidualHead(null));
  }, [clinicId, pkg]);

  useEffect(reload, [reload]);

  useEffect(() => {
    chargeService.listChargeGroups(clinicId).then(setGroups).catch(() => setGroups([]));
  }, [clinicId]);

  // one character is enough — waiting for two made the list look broken
  useEffect(() => {
    const handle = setTimeout(() => {
      if (search.trim().length < 1 || svc) { setOptions([]); return; }
      chargeService.listServices(clinicId, search).then(setOptions).catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [clinicId, search, svc]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (!editingResidual || residualSearch.trim().length < 1) { setResidualOptions([]); return; }
      chargeService.listServices(clinicId, residualSearch)
        .then(setResidualOptions).catch(() => setResidualOptions([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [clinicId, residualSearch, editingResidual]);

  const amountOf = (r: PackageBreakupRule) =>
    r.mode === 'percent' ? Math.round((pkg.package_price * r.value) / 100 * 100) / 100 : r.value;

  const componentsTotal = rules.reduce((s, r) => s + amountOf(r), 0);
  const residual = Math.round((pkg.package_price - componentsTotal) * 100) / 100;

  const add = async () => {
    if (target === 'group' && !groupId) { toast.error('Pick a charge head'); return; }
    if (target === 'service' && !svc) { toast.error('Pick a service'); return; }
    const n = Number(value);
    if (!n || n <= 0) { toast.error('Enter an amount or percentage'); return; }
    try {
      await packageService.addBreakupRule({
        clinic_id: clinicId, package_id: pkg.id,
        service_id: target === 'service' ? svc!.id : undefined,
        charge_group_id: target === 'group' ? groupId : undefined,
        mode, value: n,
        // max+1, not rules.length — after a delete the length collides with an
        // existing sort_order and the new head lands in an arbitrary position
        sort_order: rules.length ? Math.max(...rules.map((r) => r.sort_order)) + 1 : 0,
      });
      setSvc(null); setSearch(''); setGroupId(''); setValue('');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const chooseResidualHead = async (s: ServiceMaster) => {
    try {
      await packageService.updatePackage(pkg.id, { residual_service_id: s.id });
      setEditingResidual(false); setResidualSearch(''); setResidualOptions([]);
      setResidualHead({ id: s.id, name: s.name });
      toast.success(`Residual now lands on ${s.name}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveResidualLabel = async () => {
    const next = residualLabel.trim();
    if (next === (pkg.residual_label ?? '')) return;
    try {
      await packageService.updatePackage(pkg.id, { residual_label: next || null });
      toast.success(next ? `Residual will print as "${next}"` : 'Residual back to the head name');
    } catch (e) {
      toast.error((e as Error).message);
      setResidualLabel(pkg.residual_label ?? '');
    }
  };

  const changeGrain = async (g: 'charge_group' | 'service') => {
    setGrain(g);
    try {
      await packageService.updatePackage(pkg.id, { breakup_grain: g });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
      <h3 className="text-sm font-medium text-slate-700 mb-1">Claim break-up</h3>
      <p className="text-xs text-slate-400 mb-3">
        How the package price is presented on a TPA annexure. The patient's bill still shows one
        package line. Add fixed heads below, or leave the template empty to build the break-up from
        the charges the package actually absorbed.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-slate-600">
        <span className="text-slate-400">Line grain</span>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={grain === 'charge_group'} onChange={() => changeGrain('charge_group')} />
          One line per head
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={grain === 'service'} onChange={() => changeGrain('service')} />
          One line per service
        </label>
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-3">
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
                {' '.repeat((g.depth - 1) * 3)}{g.code} — {g.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="relative flex-1 min-w-44">
            <input
              value={svc ? `${svc.service_code} — ${svc.name}` : search}
              onChange={(e) => { setSearch(e.target.value); setSvc(null); }}
              placeholder="Search service (surgeon fee, OT charges…)"
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
            {options.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-44 overflow-auto">
                {options.map((s) => (
                  <li key={s.id} onClick={() => { setSvc(s); setOptions([]); }}
                    className="px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
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
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="percent">% of price</option>
          <option value="fixed">Fixed ₹</option>
        </select>
        <input type="number" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'percent' ? '%' : '₹'}
          className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={add} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <ul className="divide-y divide-slate-100 text-sm border-t border-slate-100">
        {rules.map((r) => (
          <li key={r.id} className="py-2 flex items-center gap-2">
            <span className="flex-1">
              {r.service?.name ?? r.charge_group?.name ?? '—'}
              {r.charge_group && (
                <span className="text-[10px] font-semibold text-navy-700 bg-navy-100 rounded px-1 py-0.5 ml-1.5 align-middle">
                  {r.charge_group.code}
                </span>
              )}
              <span className="text-xs text-slate-400 ml-1">
                ({r.mode === 'percent' ? `${r.value}% of price` : 'fixed'})
              </span>
            </span>
            <span className="text-slate-700">{inr(amountOf(r))}</span>
            <button onClick={() => packageService.removeBreakupRule(r.id).then(reload).catch((e) => toast.error(e.message))}
              className="p-1 text-slate-400 hover:text-red-600">
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        ))}
        <li className={`py-2 flex items-center gap-2 font-medium ${residual < 0 ? 'text-red-600' : 'text-slate-800'}`}>
          <span className="flex-1">
            {editingResidual ? (
              <span className="relative inline-block w-64 align-middle">
                <input
                  autoFocus
                  value={residualSearch}
                  onChange={(e) => setResidualSearch(e.target.value)}
                  onBlur={() => setTimeout(() => setEditingResidual(false), 200)}
                  placeholder="Search head (nursing care…)"
                  className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm font-normal"
                />
                {residualOptions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-44 overflow-auto font-normal">
                    {residualOptions.map((s) => (
                      <li key={s.id} onClick={() => chooseResidualHead(s)}
                        className="px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                        {s.service_code} — {s.name}
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            ) : (
              <button
                onClick={() => setEditingResidual(true)}
                title="Change which head absorbs the residual"
                className="underline decoration-dotted underline-offset-2"
              >
                {residualLabel.trim() || residualHead?.name || 'No residual head configured'}
              </button>
            )}
            <span className="text-xs font-normal text-slate-400 ml-1">
              (residual — always price minus everything above)
            </span>
          </span>
          <span>{inr(residual)}</span>
          <span className="w-6" />
        </li>
      </ul>

      <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between text-sm">
        <span className="text-slate-500">Break-up total</span>
        <span className="font-semibold text-slate-800">{inr(pkg.package_price)}</span>
      </div>

      <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        Residual prints as
        <input
          value={residualLabel}
          onChange={(e) => setResidualLabel(e.target.value)}
          onBlur={saveResidualLabel}
          placeholder={residualHead?.name ?? 'head name'}
          className="flex-1 min-w-44 border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-800"
        />
        <span className="text-slate-400">
          Leave blank to use the head's own name. Click the head name above to send the residual to
          a different charge code.
        </span>
      </label>

      {residual < 0 && (
        <p className="mt-2 text-xs text-red-600">
          Components exceed the package price by {inr(Math.abs(residual))}. Reduce them — a claim
          cannot be generated while the residual is negative.
        </p>
      )}
      {!residualHead && (
        <p className="mt-2 text-xs text-amber-700">
          No residual head found. Run the standard-heads seed, or flag a service as the residual head.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Class-wise package price list: TKR — General ₹1.6L / Private ₹1.9L / Suite ₹2.4L */
function ClassPricesCard({
  clinicId, pkg, bedTypes,
}: {
  clinicId: string; pkg: HospitalPackage; bedTypes: BedType[];
}) {
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    packageService
      .listClassPrices(pkg.id)
      .then((rows: PackageClassPrice[]) => {
        const map: Record<string, string> = {};
        for (const r of rows) map[r.bed_type_id] = String(r.price);
        setPrices(map);
      })
      .catch(() => setPrices({}));
  }, [pkg.id]);

  const save = async (bedTypeId: string) => {
    const raw = prices[bedTypeId];
    if (!raw || Number(raw) < 0) return;
    setSaving(bedTypeId);
    try {
      await packageService.setClassPrice({
        clinicId,
        packageId: pkg.id,
        bedTypeId,
        price: Number(raw),
      });
      toast.success('Class price saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-medium text-slate-700 mb-1">Class-wise package prices</h3>
      <p className="text-xs text-slate-400 mb-3">
        Auto-fills the agreed price at admission based on the chosen bed's class.
        Classes without a price here use the base price ₹{pkg.package_price.toLocaleString('en-IN')}.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {bedTypes.map((bt) => (
          <div key={bt.id} className="border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-medium text-slate-600 mb-1">{bt.name}</p>
            <div className="flex gap-1.5">
              <input
                type="number"
                value={prices[bt.id] ?? ''}
                onChange={(e) => setPrices({ ...prices, [bt.id]: e.target.value })}
                placeholder={`₹${pkg.package_price}`}
                className="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => save(bt.id)}
                disabled={saving === bt.id || !prices[bt.id]}
                className="bg-navy-700 hover:bg-navy-800 disabled:opacity-40 text-white text-xs rounded-lg px-2.5"
              >
                {saving === bt.id ? '…' : 'Save'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemList({
  title, items, onRemove, accent, itemLabel, defaultCapMode, onCapMode,
}: {
  title: string; items: PackageItem[]; onRemove: (id: string) => void;
  accent: 'emerald' | 'red'; itemLabel: (i: PackageItem) => string;
  defaultCapMode?: CapMode;
  onCapMode?: (id: string, mode: CapMode) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className={`text-sm font-medium mb-2 ${accent === 'emerald' ? 'text-emerald-700' : 'text-red-700'}`}>
        {title}
      </h3>
      <ul className="divide-y divide-slate-100 text-sm">
        {items.map((i) => (
          <li key={i.id} className="py-2 flex items-center gap-2">
            <span className="flex-1">
              {itemLabel(i)}
              {i.bed_type && (
                <span className="text-[10px] font-semibold text-navy-700 bg-navy-100 rounded px-1 py-0.5 ml-1.5 align-middle">
                  {i.bed_type.name}
                </span>
              )}
              {(i.max_quantity || i.max_amount) && (
                <span className="text-xs text-slate-400 ml-1">
                  (covered up to {i.max_quantity ? `${i.max_quantity} qty` : ''}{i.max_quantity && i.max_amount ? ', ' : ''}{i.max_amount ? `₹${i.max_amount}` : ''})
                </span>
              )}
            </span>
            {(i.max_quantity || i.max_amount) && onCapMode && (
              <button
                onClick={() => onCapMode(i.id, (i.cap_mode ?? defaultCapMode ?? 'split') === 'split' ? 'block' : 'split')}
                title="Click to switch: split absorbs the remaining allowance and bills the excess; exclude drops the whole charge"
                className={`text-[10px] font-semibold rounded px-1.5 py-0.5 border ${
                  (i.cap_mode ?? defaultCapMode ?? 'split') === 'split'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}
              >
                {(i.cap_mode ?? defaultCapMode ?? 'split') === 'split' ? 'split at limit' : 'exclude whole'}
              </button>
            )}
            <button onClick={() => onRemove(i.id)} className="p-1 text-slate-400 hover:text-red-600">
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="py-4 text-center text-slate-400">None</li>}
      </ul>
    </div>
  );
}
