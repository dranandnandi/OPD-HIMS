import { Fragment, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Sparkles, Pencil, Trash2, Check, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { bedService } from '../services/bedService';
import { masterService } from '../services/masterService';
import PackagesTab from '../components/Masters/PackagesTab';
import BedTypesCard from '../components/Masters/BedTypesCard';
import AiAssistantModal from '../components/Masters/AiAssistantModal';
import AccountsTab from '../components/Masters/AccountsTab';
import TemplatesTab from '../components/Masters/TemplatesTab';
import UsersTab from '../components/Masters/UsersTab';
import { documentService, DocumentTemplate } from '../services/documentService';
import type { Ward, Bed, BedType, ServiceMaster, ChargeGroup } from '../types/ipd';

type Tab = 'wards' | 'services' | 'packages' | 'accounts' | 'templates' | 'users';

export default function MastersPage() {
  const { clinicId, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('wards');
  const [wards, setWards] = useState<Ward[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [bedTypes, setBedTypes] = useState<BedType[]>([]);
  const [services, setServices] = useState<ServiceMaster[]>([]);
  const [groups, setGroups] = useState<ChargeGroup[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [showAi, setShowAi] = useState(false);

  const reload = useCallback(() => {
    if (!clinicId) return;
    Promise.all([
      bedService.listWards(clinicId),
      bedService.listBeds(clinicId),
      bedService.listBedTypes(clinicId),
      masterService.listAllServices(clinicId),
      masterService.listChargeGroups(clinicId),
    ])
      .then(([w, b, bt, s, g]) => {
        setWards(w);
        setBeds(b);
        setBedTypes(bt);
        setServices(s);
        setGroups(g);
      })
      .catch((e) => toast.error(e.message));
  }, [clinicId]);

  useEffect(reload, [reload]);

  const handleSeed = async () => {
    if (!clinicId) return;
    setSeeding(true);
    try {
      const msg = await masterService.seedDefaults(clinicId);
      toast.success(msg);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-slate-800">Masters</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAi(true)}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm px-3 py-2 rounded-lg"
          >
            <Sparkles className="w-4 h-4" />
            AI Assistant
          </button>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-1.5 border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 text-sm px-3 py-2 rounded-lg"
          >
            {seeding ? 'Seeding…' : 'Seed defaults'}
          </button>
        </div>
      </div>

      {showAi && (
        <AiAssistantModal
          clinicId={clinicId!}
          onClose={() => setShowAi(false)}
          onCreated={reload}
        />
      )}

      <div className="flex gap-1 mb-4">
        {([
          'wards', 'services', 'packages', 'accounts', 'templates',
          ...(isAdmin ? (['users'] as Tab[]) : []),
        ] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm capitalize ${
              tab === t ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {t === 'wards' ? 'Wards & Beds' : t === 'services' ? 'Services & Charge Groups' : t === 'packages' ? 'Packages' : t === 'accounts' ? 'Accounts' : t === 'templates' ? 'Document Templates' : 'Users'}
          </button>
        ))}
      </div>

      {tab === 'wards' && (
        <>
          <WardsBedsTab
            clinicId={clinicId!}
            wards={wards}
            beds={beds}
            bedTypes={bedTypes}
            onChange={reload}
          />
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <BedTypesCard clinicId={clinicId!} bedTypes={bedTypes} services={services} onChange={reload} />
          </div>
        </>
      )}
      {tab === 'services' && (
        <ServicesTab clinicId={clinicId!} services={services} groups={groups} bedTypes={bedTypes} onChange={reload} />
      )}
      {tab === 'packages' && <PackagesTab clinicId={clinicId!} />}
      {tab === 'accounts' && <AccountsTab clinicId={clinicId!} bedTypes={bedTypes} />}
      {tab === 'templates' && <TemplatesTab clinicId={clinicId!} />}
      {tab === 'users' && isAdmin && <UsersTab clinicId={clinicId!} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Class-wise rate editor for one service.
    Default = base price × class multiplier (greyed); typing an explicit rate
    saves it to the standard rate card and beats the multiplier at billing. */
function ServiceClassRates({
  clinicId, service, bedTypes,
}: {
  clinicId: string; service: ServiceMaster; bedTypes: BedType[];
}) {
  const [explicit, setExplicit] = useState<Record<string, number>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    masterService
      .listServiceClassRates(clinicId, service.id)
      .then(setExplicit)
      .catch(() => setExplicit({}));
  }, [clinicId, service.id]);

  const save = async (bedTypeId: string) => {
    const raw = edits[bedTypeId];
    if (raw === undefined) return;
    setBusy(bedTypeId);
    try {
      const value = raw.trim() === '' ? null : Number(raw);
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        toast.error('Invalid rate');
        return;
      }
      await masterService.setServiceClassRate(clinicId, service.id, bedTypeId, value);
      setExplicit((prev) => {
        const next = { ...prev };
        if (value === null) delete next[bedTypeId];
        else next[bedTypeId] = value;
        return next;
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[bedTypeId];
        return next;
      });
      toast.success(value === null ? 'Back to auto (multiplier) rate' : `Class rate ₹${value} saved`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="text-xs text-slate-400 mb-1.5">
        Class-wise rates for <b className="text-slate-600">{service.name}</b> — auto = base ₹{service.base_price} × class multiplier.
        Type a rate to override; clear the box and save to return to auto.
      </p>
      <div className="flex flex-wrap gap-2">
        {bedTypes.map((bt) => {
          const auto = Math.round(service.base_price * (bt.rate_multiplier ?? 1) * 100) / 100;
          const hasExplicit = explicit[bt.id] !== undefined;
          const current = edits[bt.id] ?? (hasExplicit ? String(explicit[bt.id]) : '');
          const dirty = edits[bt.id] !== undefined;
          return (
            <div key={bt.id} className={`border rounded-lg px-2.5 py-1.5 ${hasExplicit ? 'border-navy-300 bg-navy-50/40' : 'border-slate-200 bg-white'}`}>
              <p className="text-[11px] font-medium text-slate-600">
                {bt.name}
                <span className="text-slate-400 font-normal"> ×{bt.rate_multiplier ?? 1}</span>
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="number"
                  value={current}
                  onChange={(e) => setEdits({ ...edits, [bt.id]: e.target.value })}
                  placeholder={`auto ₹${auto}`}
                  className="w-24 border border-slate-300 rounded px-1.5 py-0.5 text-xs"
                />
                {dirty && (
                  <button
                    onClick={() => save(bt.id)}
                    disabled={busy === bt.id}
                    className="text-[10px] bg-navy-700 text-white rounded px-1.5 py-0.5 disabled:opacity-50"
                  >
                    {busy === bt.id ? '…' : 'Save'}
                  </button>
                )}
              </div>
              <p className="text-[10px] mt-0.5 text-slate-400">
                {hasExplicit ? 'explicit rate' : `auto ₹${auto}`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function WardsBedsTab({
  clinicId, wards, beds, bedTypes, onChange,
}: {
  clinicId: string; wards: Ward[]; beds: Bed[]; bedTypes: BedType[]; onChange: () => void;
}) {
  const [wardName, setWardName] = useState('');
  const [wardType, setWardType] = useState<Ward['ward_type']>('general');
  const [bedWardId, setBedWardId] = useState('');
  const [bedNumber, setBedNumber] = useState('');
  const [bedTypeId, setBedTypeId] = useState('');

  const addWard = async () => {
    if (!wardName.trim()) return;
    try {
      await masterService.createWard({ clinic_id: clinicId, name: wardName.trim(), floor: null, ward_type: wardType });
      setWardName('');
      toast.success('Ward added');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const addBed = async () => {
    if (!bedWardId || !bedNumber.trim() || !bedTypeId) return;
    try {
      await masterService.createBed({
        clinic_id: clinicId, ward_id: bedWardId, bed_number: bedNumber.trim(), bed_type_id: bedTypeId,
      });
      setBedNumber('');
      toast.success('Bed added');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const removeWard = async (w: Ward) => {
    const attached = beds.filter((b) => b.ward_id === w.id);
    if (attached.length > 0) {
      toast.error(`"${w.name}" still has ${attached.length} bed(s) — delete them first`);
      return;
    }
    if (!confirm(`Delete ward "${w.name}"?`)) return;
    try {
      await masterService.deactivateWard(w.id);
      toast.success('Ward deleted');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const removeBed = async (b: Bed) => {
    if (b.status === 'occupied') {
      toast.error(`Bed ${b.bed_number} is occupied — discharge or transfer the patient first`);
      return;
    }
    if (!confirm(`Delete bed ${b.bed_number}${b.ward?.name ? ` (${b.ward.name})` : ''}?`)) return;
    try {
      await masterService.deactivateBed(b.id);
      toast.success('Bed deleted');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Wards</h2>
        <div className="flex gap-2 mb-3">
          <input
            value={wardName}
            onChange={(e) => setWardName(e.target.value)}
            placeholder="Ward name"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />
          <select
            value={wardType}
            onChange={(e) => setWardType(e.target.value as Ward['ward_type'])}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          >
            {['general', 'private', 'icu', 'hdu', 'maternity', 'pediatric', 'isolation'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button onClick={addWard} className="bg-blue-600 text-white rounded-lg px-3">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <ul className="text-sm divide-y divide-slate-100">
          {wards.map((w) => (
            <li key={w.id} className="py-2 flex justify-between items-center gap-2">
              <span>{w.name}</span>
              <span className="flex items-center gap-1 shrink-0">
                <span className="text-slate-400 capitalize">{w.ward_type}</span>
                <button onClick={() => removeWard(w)} title="Delete ward"
                  className="p-1 text-slate-400 hover:text-red-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          ))}
          {wards.length === 0 && <li className="py-4 text-slate-400 text-center">No wards — seed defaults or add one</li>}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Beds ({beds.length})</h2>
        <div className="flex gap-2 mb-3">
          <select
            value={bedWardId}
            onChange={(e) => setBedWardId(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1"
          >
            <option value="">Ward…</option>
            {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input
            value={bedNumber}
            onChange={(e) => setBedNumber(e.target.value)}
            placeholder="Bed #"
            className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          />
          <select
            value={bedTypeId}
            onChange={(e) => setBedTypeId(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1"
          >
            <option value="">Type…</option>
            {bedTypes.map((bt) => <option key={bt.id} value={bt.id}>{bt.name}</option>)}
          </select>
          <button onClick={addBed} className="bg-blue-600 text-white rounded-lg px-3">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1.5">Bed</th><th>Ward</th><th>Type</th><th>Status</th><th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {beds.map((b) => (
                <tr key={b.id} className="border-b border-slate-100">
                  <td className="py-1.5">{b.bed_number}</td>
                  <td>{b.ward?.name}</td>
                  <td>{b.bed_type?.name}</td>
                  <td className="capitalize">{b.status}</td>
                  <td className="text-right">
                    <button onClick={() => removeBed(b)} title="Delete bed"
                      className="p-1 text-slate-400 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ServicesTab({
  clinicId, services, groups, bedTypes, onChange,
}: {
  clinicId: string; services: ServiceMaster[]; groups: ChargeGroup[];
  bedTypes: BedType[]; onChange: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);

  useEffect(() => {
    documentService.listTemplates(clinicId, true).then(setTemplates).catch(() => setTemplates([]));
  }, [clinicId]);

  const linkTemplate = async (s: ServiceMaster, templateId: string) => {
    try {
      await masterService.updateService(s.id, {
        document_template_id: templateId || null,
      } as Partial<ServiceMaster>);
      toast.success(templateId ? 'Document linked — offered when this service is posted' : 'Document link removed');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const importOpd = async () => {
    setImporting(true);
    try {
      const { created, skipped } = await masterService.importOpdServices(clinicId);
      toast.success(`OPD catalog merged — ${created} service(s) created, ${skipped} already present`);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  };
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [price, setPrice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', price: '', cost: '' });

  const activeServices = services.filter((s) => s.is_active);

  // Auto-suggest the next sequential code for the chosen charge group
  // (PROC-DRESS → PROC-DRESS-003). User edits win until the group changes.
  const suggestCode = (gId: string) => {
    const group = groups.find((g) => g.id === gId);
    if (!group) return '';
    const prefix = `${group.code}-`;
    const existing = services
      .filter((s) => s.service_code.toUpperCase().startsWith(prefix.toUpperCase()))
      .map((s) => {
        const tail = s.service_code.slice(prefix.length);
        const n = parseInt(tail, 10);
        return Number.isFinite(n) ? n : 0;
      });
    let next = (existing.length ? Math.max(...existing) : 0) + 1;
    let candidate = `${prefix}${String(next).padStart(3, '0')}`;
    while (services.some((s) => s.service_code.toUpperCase() === candidate.toUpperCase())) {
      next += 1;
      candidate = `${prefix}${String(next).padStart(3, '0')}`;
    }
    return candidate;
  };

  const handleGroupChange = (gId: string) => {
    setGroupId(gId);
    setCodeTouched(false);
    setCode(gId ? suggestCode(gId) : '');
  };

  const startEdit = (s: ServiceMaster) => {
    setEditingId(s.id);
    setEdit({ name: s.name, price: String(s.base_price), cost: String(s.base_cost) });
  };

  const saveEdit = async (s: ServiceMaster) => {
    try {
      await masterService.updateService(s.id, {
        name: edit.name.trim() || s.name,
        base_price: Number(edit.price) || 0,
        base_cost: Number(edit.cost) || 0,
      });
      toast.success('Service updated');
      setEditingId(null);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const deactivate = async (s: ServiceMaster) => {
    if (!confirm(`Deactivate "${s.name}"? Past charges keep it; it disappears from pickers.`)) return;
    try {
      await masterService.updateService(s.id, { is_active: false });
      toast.success('Service deactivated');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const addService = async () => {
    if (!code.trim() || !name.trim() || !groupId) return;
    try {
      await masterService.createService({
        clinic_id: clinicId,
        service_code: code.trim().toUpperCase(),
        name: name.trim(),
        charge_group_id: groupId,
        base_price: Number(price) || 0,
      });
      setName(''); setPrice('');
      setCodeTouched(false);
      setCode(groupId ? suggestCode(groupId) : ''); // next in sequence for quick entry
      toast.success('Service added');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap gap-2 mb-4">
        <input value={code}
          onChange={(e) => { setCode(e.target.value); setCodeTouched(true); }}
          placeholder="Code (auto)"
          title="Auto-suggested from the charge group — editable"
          className={`w-36 border rounded-lg px-2 py-1.5 text-sm font-mono ${codeTouched ? 'border-slate-300' : 'border-emerald-300 bg-emerald-50/40'}`} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Service name"
          className="flex-1 min-w-40 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <select value={groupId} onChange={(e) => handleGroupChange(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">Charge group…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{' '.repeat((g.depth - 1) * 3)}{g.name}</option>
          ))}
        </select>
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" type="number"
          className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={addService} className="bg-blue-600 text-white rounded-lg px-3">
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={importOpd}
          disabled={importing}
          title="Copy OPD's priced tests (lab/radiology) into the charge-code structure under INV"
          className="text-sm border border-navy-300 text-navy-700 rounded-lg px-3 py-1.5 hover:bg-navy-50 disabled:opacity-50"
        >
          {importing ? 'Importing…' : '⇪ Import OPD tests'}
        </button>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5">Code</th><th>Name</th><th>Group</th>
              <th className="text-right">Price</th><th className="text-right">Cost</th>
              <th className="text-right w-20"></th>
            </tr>
          </thead>
          <tbody>
            {activeServices.map((s) => {
              const g = groups.find((x) => x.id === s.charge_group_id);
              const isEditing = editingId === s.id;
              return (
                <Fragment key={s.id}>
                <tr className="border-b border-slate-100">
                  <td className="py-1.5 font-mono text-xs">
                    <button
                      onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      title="Class-wise rates"
                      className="mr-1 text-slate-400 hover:text-navy-700"
                    >
                      {expandedId === s.id ? '▾' : '▸'}
                    </button>
                    {s.service_code}
                  </td>
                  <td>
                    {isEditing ? (
                      <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                        className="w-full border border-slate-300 rounded px-2 py-0.5 text-sm" />
                    ) : s.name}
                  </td>
                  <td className="text-slate-400 text-xs">{g?.path}</td>
                  <td className="text-right">
                    {isEditing ? (
                      <input type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })}
                        className="w-20 border border-slate-300 rounded px-1.5 py-0.5 text-sm text-right" />
                    ) : `₹${s.base_price.toFixed(0)}`}
                  </td>
                  <td className="text-right text-slate-400">
                    {isEditing ? (
                      <input type="number" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })}
                        className="w-20 border border-slate-300 rounded px-1.5 py-0.5 text-sm text-right" />
                    ) : `₹${s.base_cost.toFixed(0)}`}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button onClick={() => saveEdit(s)} title="Save"
                          className="p-1 text-emerald-600 hover:text-emerald-700">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditingId(null)} title="Cancel"
                          className="p-1 text-slate-400 hover:text-slate-600">
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(s)} title="Edit"
                          className="p-1 text-slate-400 hover:text-navy-700">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => deactivate(s)} title="Deactivate"
                          className="p-1 text-slate-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {expandedId === s.id && (
                  <tr className="border-b border-slate-200 bg-slate-50/60">
                    <td colSpan={6} className="py-2 px-3">
                      <ServiceClassRates clinicId={clinicId} service={s} bedTypes={bedTypes} />
                      <div className="mt-3 pt-2 border-t border-slate-200 flex items-center gap-2">
                        <span className="text-xs text-slate-500">
                          Linked document (offered when this service is posted — consent, OT note…):
                        </span>
                        <select
                          value={s.document_template_id ?? ''}
                          onChange={(e) => linkTemplate(s, e.target.value)}
                          className="border border-slate-300 rounded-lg px-2 py-1 text-xs"
                        >
                          <option value="">None</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.doc_type.replace(/_/g, ' ')})
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {activeServices.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-slate-400">No services — click “Seed defaults”</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
