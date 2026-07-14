import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Building2, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { masterService } from '../../services/masterService';
import { packageService, HospitalPackage } from '../../services/packageService';
import { chargeService } from '../../services/chargeService';
import type { Payer, BedType, ServiceMaster } from '../../types/ipd';

const PAYER_TYPES: Array<{ value: Payer['payer_type']; label: string }> = [
  { value: 'insurer', label: 'Insurance' },
  { value: 'tpa', label: 'TPA' },
  { value: 'government_scheme', label: 'Govt Scheme (CGHS/ECHS/PMJAY…)' },
  { value: 'corporate', label: 'Corporate tie-up' },
  { value: 'cash', label: 'Cash / Self-pay' },
];

interface Props {
  clinicId: string;
  bedTypes: BedType[];
}

export default function AccountsTab({ clinicId, bedTypes }: Props) {
  const [payers, setPayers] = useState<Payer[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // create form
  const [form, setForm] = useState({
    name: '', type: 'insurer' as Payer['payer_type'], contact: '', phone: '',
    email: '', gst: '', discount: '', creditLimit: '', creditDays: '',
  });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    masterService.listPayers(clinicId).then(setPayers).catch((e) => toast.error(e.message));
  }, [clinicId]);

  useEffect(reload, [reload]);

  const create = async () => {
    if (!form.name.trim()) { toast.error('Account name required'); return; }
    setSaving(true);
    try {
      await masterService.createPayer({
        clinic_id: clinicId,
        name: form.name.trim(),
        payer_type: form.type,
        contact_person: form.contact || null,
        billing_phone: form.phone || null,
        billing_email: form.email || null,
        gst_number: form.gst || null,
        default_discount_percent: Number(form.discount) || 0,
        credit_limit: Number(form.creditLimit) || 0,
        credit_days: Number(form.creditDays) || 0,
      });
      toast.success('Account created — open it to tag price lists');
      setForm({ name: '', type: 'insurer', contact: '', phone: '', email: '', gst: '', discount: '', creditLimit: '', creditDays: '' });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* create account */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h2 className="text-sm font-medium text-slate-700 mb-2">New account (insurer / TPA / scheme / corporate)</h2>
        <div className="grid sm:grid-cols-3 gap-2 text-sm">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Account name (Star Health, CGHS, TCS…) *"
            className="sm:col-span-2 border border-slate-300 rounded-lg px-3 py-1.5" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Payer['payer_type'] })}
            className="border border-slate-300 rounded-lg px-2 py-1.5">
            {PAYER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })}
            placeholder="Contact person" className="border border-slate-300 rounded-lg px-3 py-1.5" />
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Billing phone" className="border border-slate-300 rounded-lg px-3 py-1.5" />
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Billing email" className="border border-slate-300 rounded-lg px-3 py-1.5" />
          <input value={form.gst} onChange={(e) => setForm({ ...form, gst: e.target.value })}
            placeholder="GST number" className="border border-slate-300 rounded-lg px-3 py-1.5" />
          <input type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })}
            placeholder="Default discount %" className="border border-slate-300 rounded-lg px-3 py-1.5" />
          <input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            placeholder="Credit limit ₹" className="border border-slate-300 rounded-lg px-3 py-1.5" />
          <input type="number" value={form.creditDays} onChange={(e) => setForm({ ...form, creditDays: e.target.value })}
            placeholder="Credit days" className="border border-slate-300 rounded-lg px-3 py-1.5" />
        </div>
        <button onClick={create} disabled={saving}
          className="mt-2 flex items-center gap-1.5 bg-navy-700 hover:bg-navy-800 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg">
          <Plus className="w-4 h-4" /> {saving ? 'Creating…' : 'Create account'}
        </button>
      </div>

      {/* account list */}
      <div className="space-y-2">
        {payers.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-slate-200">
            <button
              onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
              className="w-full flex items-center gap-3 p-3 text-left"
            >
              {expandedId === p.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              <Building2 className="w-4 h-4 text-navy-600" />
              <span className="flex-1 text-sm">
                <b className="text-slate-800">{p.name}</b>
                <span className="ml-2 text-xs uppercase bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">
                  {PAYER_TYPES.find((t) => t.value === p.payer_type)?.label ?? p.payer_type}
                </span>
                {p.default_discount_percent > 0 && (
                  <span className="ml-2 text-xs text-violet-700">disc {p.default_discount_percent}%</span>
                )}
              </span>
              <span className="text-xs text-slate-400">
                credit ₹{Number(p.credit_limit).toLocaleString('en-IN')} · {p.credit_days} days
              </span>
            </button>
            {expandedId === p.id && (
              <div className="border-t border-slate-100 p-3">
                <AccountPriceLists clinicId={clinicId} payer={p} bedTypes={bedTypes} />
              </div>
            )}
          </div>
        ))}
        {payers.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-400">
            No accounts yet — create your insurers, TPAs, schemes and corporates above.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Price-list tagging for one account: package prices (class-optional) and
// service rates on the account's tariff plan.
// ---------------------------------------------------------------------------

function AccountPriceLists({
  clinicId, payer, bedTypes,
}: {
  clinicId: string; payer: Payer; bedTypes: BedType[];
}) {
  const [packages, setPackages] = useState<HospitalPackage[]>([]);
  const [pkgPrices, setPkgPrices] = useState<Awaited<ReturnType<typeof masterService.listPayerPackagePrices>>>([]);
  const [svcRates, setSvcRates] = useState<Awaited<ReturnType<typeof masterService.listPayerServiceRates>>>([]);
  // package price form
  const [pkgId, setPkgId] = useState('');
  const [pkgClass, setPkgClass] = useState('');
  const [pkgPrice, setPkgPrice] = useState('');
  // service rate form
  const [svcSearch, setSvcSearch] = useState('');
  const [svcOptions, setSvcOptions] = useState<ServiceMaster[]>([]);
  const [svc, setSvc] = useState<ServiceMaster | null>(null);
  const [svcClass, setSvcClass] = useState('');
  const [svcRate, setSvcRate] = useState('');

  const reload = useCallback(() => {
    masterService.listPayerPackagePrices(payer.id).then(setPkgPrices).catch(() => setPkgPrices([]));
    masterService.listPayerServiceRates(clinicId, payer.id).then(setSvcRates).catch(() => setSvcRates([]));
  }, [clinicId, payer.id]);

  useEffect(() => {
    reload();
    packageService.listPackages(clinicId).then(setPackages).catch(() => setPackages([]));
  }, [reload, clinicId]);

  useEffect(() => {
    const h = setTimeout(() => {
      if (svc || svcSearch.trim().length < 2) { setSvcOptions([]); return; }
      chargeService.listServices(clinicId, svcSearch).then(setSvcOptions).catch(() => setSvcOptions([]));
    }, 300);
    return () => clearTimeout(h);
  }, [clinicId, svcSearch, svc]);

  const addPkgPrice = async () => {
    if (!pkgId || !pkgPrice) { toast.error('Pick package and price'); return; }
    try {
      await masterService.setPayerPackagePrice({
        clinicId, payerId: payer.id, packageId: pkgId,
        bedTypeId: pkgClass || null, price: Number(pkgPrice),
      });
      toast.success('Package price tagged to account');
      setPkgId(''); setPkgClass(''); setPkgPrice('');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const addSvcRate = async () => {
    if (!svc || !svcRate) { toast.error('Pick service and rate'); return; }
    try {
      await masterService.setPayerServiceRate({
        clinicId, payerId: payer.id, serviceId: svc.id,
        bedTypeId: svcClass || null, rate: Number(svcRate),
      });
      toast.success('Service rate tagged to account');
      setSvc(null); setSvcSearch(''); setSvcClass(''); setSvcRate('');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4 text-sm">
      {/* package price list */}
      <div>
        <h3 className="text-xs font-semibold text-slate-600 uppercase mb-1.5">Package price list</h3>
        <div className="flex flex-wrap gap-1.5 mb-2">
          <select value={pkgId} onChange={(e) => setPkgId(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs flex-1 min-w-32">
            <option value="">Package…</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={pkgClass} onChange={(e) => setPkgClass(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
            <option value="">All classes</option>
            {bedTypes.map((bt) => <option key={bt.id} value={bt.id}>{bt.name}</option>)}
          </select>
          <input type="number" value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)}
            placeholder="₹" className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          <button onClick={addPkgPrice} className="bg-blue-600 text-white rounded-lg px-2.5">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <ul className="divide-y divide-slate-100">
          {pkgPrices.map((r) => (
            <li key={r.id} className="py-1.5 flex items-center gap-2 text-xs">
              <span className="flex-1">
                {r.package?.name}
                {r.bed_type ? <span className="text-navy-700"> [{r.bed_type.name}]</span> : <span className="text-slate-400"> [all classes]</span>}
              </span>
              <b>₹{Number(r.price).toLocaleString('en-IN')}</b>
              <button onClick={async () => { await masterService.removePayerPackagePrice(r.id); reload(); }}
                className="p-0.5 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
          {pkgPrices.length === 0 && <li className="py-2 text-xs text-slate-400">No package prices — uses standard/class prices</li>}
        </ul>
      </div>

      {/* service rate list */}
      <div>
        <h3 className="text-xs font-semibold text-slate-600 uppercase mb-1.5">Service rate list</h3>
        <div className="flex flex-wrap gap-1.5 mb-2">
          <div className="relative flex-1 min-w-32">
            <input
              value={svc ? `${svc.service_code} — ${svc.name}` : svcSearch}
              onChange={(e) => { setSvcSearch(e.target.value); setSvc(null); }}
              placeholder="Service…"
              className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
            />
            {svcOptions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-40 overflow-auto">
                {svcOptions.map((s) => (
                  <li key={s.id} onClick={() => { setSvc(s); setSvcOptions([]); }}
                    className="px-2 py-1 text-xs hover:bg-slate-50 cursor-pointer">
                    {s.service_code} — {s.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <select value={svcClass} onChange={(e) => setSvcClass(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
            <option value="">All classes</option>
            {bedTypes.map((bt) => <option key={bt.id} value={bt.id}>{bt.name}</option>)}
          </select>
          <input type="number" value={svcRate} onChange={(e) => setSvcRate(e.target.value)}
            placeholder="₹" className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          <button onClick={addSvcRate} className="bg-blue-600 text-white rounded-lg px-2.5">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <ul className="divide-y divide-slate-100">
          {svcRates.map((r) => (
            <li key={r.id} className="py-1.5 flex items-center gap-2 text-xs">
              <span className="flex-1">
                <span className="font-mono">{r.service?.service_code}</span> {r.service?.name}
                {r.bed_type ? <span className="text-navy-700"> [{r.bed_type.name}]</span> : <span className="text-slate-400"> [all classes]</span>}
              </span>
              <b>₹{Number(r.rate ?? 0).toLocaleString('en-IN')}</b>
              <button
                onClick={async () => {
                  await masterService.setPayerServiceRate({
                    clinicId, payerId: payer.id, serviceId: r.service_id,
                    bedTypeId: r.bed_type_id, rate: null,
                  });
                  reload();
                }}
                className="p-0.5 text-slate-300 hover:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
          {svcRates.length === 0 && <li className="py-2 text-xs text-slate-400">No service rates — uses standard rates × class multiplier</li>}
        </ul>
      </div>
    </div>
  );
}
