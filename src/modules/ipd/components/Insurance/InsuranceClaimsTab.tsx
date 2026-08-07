import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Shield, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  insuranceService, InsuranceDetails, Preauth, Claim, ClaimDeduction, PayerOption,
} from '../../services/insuranceService';
import type { Admission } from '../../types/ipd';

const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const PREAUTH_STATUS: Preauth['status'][] = ['requested', 'queried', 'approved', 'partial', 'rejected'];
const CLAIM_STATUS: Claim['status'][] = ['draft', 'submitted', 'queried', 'approved', 'settled', 'rejected'];
const DEDUCTION_CATEGORIES: ClaimDeduction['category'][] = [
  'non_payable', 'consumable', 'excess', 'policy_exclusion', 'documentation', 'other',
];

export default function InsuranceClaimsTab({ admission }: { admission: Admission }) {
  const { clinicId, profile } = useAuth();
  const [payers, setPayers] = useState<PayerOption[]>([]);
  const [insurance, setInsurance] = useState<InsuranceDetails | null>(null);
  const [preauths, setPreauths] = useState<Preauth[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);

  const reload = useCallback(() => {
    if (!clinicId) return;
    insuranceService.getInsurance(admission.id).then(setInsurance).catch(() => {});
    insuranceService.listPreauths(admission.id).then(setPreauths).catch(() => {});
    insuranceService.listClaims(admission.id).then(setClaims).catch(() => {});
  }, [admission.id, clinicId]);

  useEffect(() => {
    if (!clinicId) return;
    insuranceService.listPayers(clinicId).then(setPayers).catch(() => {});
    reload();
  }, [clinicId, reload]);

  if (!clinicId) return null;

  return (
    <div className="space-y-4">
      <InsuranceForm
        clinicId={clinicId}
        admissionId={admission.id}
        userId={profile?.id}
        payers={payers}
        initial={insurance}
        onSaved={setInsurance}
      />
      <PreauthSection
        clinicId={clinicId}
        admissionId={admission.id}
        userId={profile?.id}
        preauths={preauths}
        onChange={reload}
      />
      <ClaimsSection
        clinicId={clinicId}
        admissionId={admission.id}
        userId={profile?.id}
        claims={claims}
        onChange={reload}
      />
    </div>
  );
}

// --- insurance details -------------------------------------------------------
function InsuranceForm({
  clinicId, admissionId, userId, payers, initial, onSaved,
}: {
  clinicId: string; admissionId: string; userId?: string; payers: PayerOption[];
  initial: InsuranceDetails | null; onSaved: (d: InsuranceDetails) => void;
}) {
  const [form, setForm] = useState({
    payer_id: '', insurer_name: '', tpa_name: '', policy_number: '', member_id: '',
    sum_insured: '', co_pay_percent: '', room_rent_cap: '', policy_valid_till: '',
    is_corporate: false, notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        payer_id: initial.payer_id ?? '',
        insurer_name: initial.insurer_name ?? '',
        tpa_name: initial.tpa_name ?? '',
        policy_number: initial.policy_number ?? '',
        member_id: initial.member_id ?? '',
        sum_insured: initial.sum_insured ? String(initial.sum_insured) : '',
        co_pay_percent: initial.co_pay_percent ? String(initial.co_pay_percent) : '',
        room_rent_cap: initial.room_rent_cap != null ? String(initial.room_rent_cap) : '',
        policy_valid_till: initial.policy_valid_till ?? '',
        is_corporate: initial.is_corporate,
        notes: initial.notes ?? '',
      });
    }
  }, [initial]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await insuranceService.upsertInsurance({
        clinicId, admissionId, userId,
        values: {
          payer_id: form.payer_id || null,
          insurer_name: form.insurer_name || null,
          tpa_name: form.tpa_name || null,
          policy_number: form.policy_number || null,
          member_id: form.member_id || null,
          sum_insured: Number(form.sum_insured) || 0,
          co_pay_percent: Number(form.co_pay_percent) || 0,
          room_rent_cap: form.room_rent_cap ? Number(form.room_rent_cap) : null,
          policy_valid_till: form.policy_valid_till || null,
          is_corporate: form.is_corporate,
          notes: form.notes || null,
        },
      });
      onSaved(saved);
      toast.success('Insurance details saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-4 h-4 text-navy-600" />
        <span className="font-medium text-sm text-slate-800">Insurance / Policy details</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <label className="text-xs text-slate-500">Payer / Account
          <select value={form.payer_id} onChange={(e) => setForm({ ...form, payer_id: e.target.value })} className={inputCls}>
            <option value="">— select —</option>
            {payers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.payer_type})</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Insurer
          <input value={form.insurer_name} onChange={(e) => setForm({ ...form, insurer_name: e.target.value })} className={inputCls} />
        </label>
        <label className="text-xs text-slate-500">TPA
          <input value={form.tpa_name} onChange={(e) => setForm({ ...form, tpa_name: e.target.value })} className={inputCls} />
        </label>
        <label className="text-xs text-slate-500">Policy number
          <input value={form.policy_number} onChange={(e) => setForm({ ...form, policy_number: e.target.value })} className={inputCls} />
        </label>
        <label className="text-xs text-slate-500">Member / UHID
          <input value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })} className={inputCls} />
        </label>
        <label className="text-xs text-slate-500">Sum insured (₹)
          <input type="number" value={form.sum_insured} onChange={(e) => setForm({ ...form, sum_insured: e.target.value })} className={inputCls} />
        </label>
        <label className="text-xs text-slate-500">Co-pay (%)
          <input type="number" value={form.co_pay_percent} onChange={(e) => setForm({ ...form, co_pay_percent: e.target.value })} className={inputCls} />
        </label>
        <label className="text-xs text-slate-500">Room-rent cap (₹/day)
          <input type="number" value={form.room_rent_cap} onChange={(e) => setForm({ ...form, room_rent_cap: e.target.value })} className={inputCls} />
        </label>
        <label className="text-xs text-slate-500">Policy valid till
          <input type="date" value={form.policy_valid_till} onChange={(e) => setForm({ ...form, policy_valid_till: e.target.value })} className={inputCls} />
        </label>
      </div>
      <div className="flex items-center justify-between mt-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.is_corporate} onChange={(e) => setForm({ ...form, is_corporate: e.target.checked })} />
          Corporate / credit billing
        </label>
        <button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// --- pre-authorizations ------------------------------------------------------
function PreauthSection({
  clinicId, admissionId, userId, preauths, onChange,
}: {
  clinicId: string; admissionId: string; userId?: string; preauths: Preauth[]; onChange: () => void;
}) {
  const [type, setType] = useState<'initial' | 'enhancement'>('initial');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!Number(amount)) return;
    setBusy(true);
    try {
      await insuranceService.createPreauth({
        clinicId, admissionId, userId, preauthType: type, requestedAmount: Number(amount),
      });
      setAmount('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approvedTotal = preauths
    .filter((p) => p.status === 'approved' || p.status === 'partial')
    .reduce((s, p) => s + Number(p.approved_amount ?? 0), 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium text-sm text-slate-800">Pre-authorizations</span>
        <span className="text-xs text-slate-500">Approved so far: <b className="text-emerald-700">{inr(approvedTotal)}</b></span>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-3">
        <select value={type} onChange={(e) => setType(e.target.value as 'initial' | 'enhancement')} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="initial">Initial</option>
          <option value="enhancement">Enhancement</option>
        </select>
        <input type="number" placeholder="Requested ₹" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={add} disabled={busy || !Number(amount)} className="flex items-center gap-1 bg-navy-700 hover:bg-navy-800 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg">
          <Plus className="w-4 h-4" /> Request
        </button>
      </div>

      {preauths.length === 0 ? (
        <p className="text-xs text-slate-400">No pre-authorization raised yet.</p>
      ) : (
        <div className="space-y-1.5">
          {preauths.map((p) => <PreauthRow key={p.id} preauth={p} onChange={onChange} />)}
        </div>
      )}
    </div>
  );
}

function PreauthRow({ preauth, onChange }: { preauth: Preauth; onChange: () => void }) {
  const [approved, setApproved] = useState(preauth.approved_amount != null ? String(preauth.approved_amount) : '');
  const [ref, setRef] = useState(preauth.approval_ref ?? '');

  const setStatus = async (status: Preauth['status']) => {
    try {
      await insuranceService.updatePreauth(preauth.id, {
        status,
        approved_amount: approved ? Number(approved) : null,
        approval_ref: ref || null,
        approved_at: status === 'approved' || status === 'partial' ? new Date().toISOString() : null,
      });
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm border border-slate-100 rounded-lg px-3 py-2">
      <span className="capitalize text-slate-600 w-24">{preauth.preauth_type}</span>
      <span className="font-medium">{inr(preauth.requested_amount)}</span>
      <input placeholder="Approved ₹" type="number" value={approved} onChange={(e) => setApproved(e.target.value)} className="w-24 border border-slate-300 rounded px-2 py-1" />
      <input placeholder="Approval ref" value={ref} onChange={(e) => setRef(e.target.value)} className="w-28 border border-slate-300 rounded px-2 py-1" />
      <select value={preauth.status} onChange={(e) => setStatus(e.target.value as Preauth['status'])} className="border border-slate-300 rounded px-2 py-1 capitalize">
        {PREAUTH_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

// --- claims ------------------------------------------------------------------
function ClaimsSection({
  clinicId, admissionId, userId, claims, onChange,
}: {
  clinicId: string; admissionId: string; userId?: string; claims: Claim[]; onChange: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [claimNo, setClaimNo] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!Number(amount)) return;
    setBusy(true);
    try {
      await insuranceService.createClaim({
        clinicId, admissionId, userId, claimedAmount: Number(amount), claimNumber: claimNo || undefined,
      });
      setAmount(''); setClaimNo('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="font-medium text-sm text-slate-800 mb-3">Claims</div>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <input type="number" placeholder="Claimed ₹" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <input placeholder="Claim / CCN no." value={claimNo} onChange={(e) => setClaimNo(e.target.value)} className="w-40 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={add} disabled={busy || !Number(amount)} className="flex items-center gap-1 bg-navy-700 hover:bg-navy-800 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg">
          <Plus className="w-4 h-4" /> New claim
        </button>
      </div>
      {claims.length === 0 ? (
        <p className="text-xs text-slate-400">No claim created yet.</p>
      ) : (
        <div className="space-y-2">
          {claims.map((c) => <ClaimRow key={c.id} clinicId={clinicId} userId={userId} claim={c} onChange={onChange} />)}
        </div>
      )}
    </div>
  );
}

function ClaimRow({ clinicId, userId, claim, onChange }: { clinicId: string; userId?: string; claim: Claim; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [approved, setApproved] = useState(String(claim.approved_amount || ''));
  const [received, setReceived] = useState(String(claim.received_amount || ''));
  const [deductions, setDeductions] = useState<ClaimDeduction[]>([]);

  const loadDeductions = useCallback(() => {
    insuranceService.listDeductions(claim.id).then(setDeductions).catch(() => {});
  }, [claim.id]);

  useEffect(() => { if (open) loadDeductions(); }, [open, loadDeductions]);

  const patientShare = deductions.filter((d) => d.borne_by === 'patient').reduce((s, d) => s + Number(d.amount), 0);
  const hospitalShare = deductions.filter((d) => d.borne_by === 'hospital').reduce((s, d) => s + Number(d.amount), 0);

  const saveAmounts = async (status?: Claim['status']) => {
    try {
      await insuranceService.updateClaim(claim.id, {
        approved_amount: Number(approved) || 0,
        received_amount: Number(received) || 0,
        ...(status ? { status } : {}),
        ...(status === 'submitted' ? { submitted_at: new Date().toISOString() } : {}),
        ...(status === 'settled' ? { settled_at: new Date().toISOString() } : {}),
      });
      onChange();
      toast.success('Claim updated');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg">
      <div className="flex flex-wrap items-center gap-2 text-sm px-3 py-2">
        <button onClick={() => setOpen((o) => !o)} className="text-slate-500">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <span className="font-medium">{claim.claim_number || 'Claim'}</span>
        <span className="text-slate-500">claimed {inr(claim.claimed_amount)}</span>
        <span className="text-emerald-700">recd {inr(claim.received_amount)}</span>
        <span className="text-red-600">deducted {inr(claim.deducted_amount)}</span>
        <select
          value={claim.status}
          onChange={(e) => saveAmounts(e.target.value as Claim['status'])}
          className="ml-auto border border-slate-300 rounded px-2 py-1 capitalize"
        >
          {CLAIM_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {open && (
        <div className="border-t border-slate-100 p-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">Approved ₹
              <input type="number" value={approved} onChange={(e) => setApproved(e.target.value)} className="block w-28 border border-slate-300 rounded px-2 py-1" />
            </label>
            <label className="text-xs text-slate-500">Received ₹
              <input type="number" value={received} onChange={(e) => setReceived(e.target.value)} className="block w-28 border border-slate-300 rounded px-2 py-1" />
            </label>
            <button onClick={() => saveAmounts()} className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded-lg">Save amounts</button>
          </div>

          <DeductionEditor
            clinicId={clinicId}
            claimId={claim.id}
            userId={userId}
            deductions={deductions}
            onChange={() => { loadDeductions(); insuranceService.recomputeClaimDeductions(claim.id).then(onChange); }}
          />

          <p className="text-xs text-slate-500">
            Deduction split — patient: <b>{inr(patientShare)}</b> · hospital write-off: <b>{inr(hospitalShare)}</b>
          </p>
        </div>
      )}
    </div>
  );
}

function DeductionEditor({
  clinicId, claimId, userId, deductions, onChange,
}: {
  clinicId: string; claimId: string; userId?: string; deductions: ClaimDeduction[]; onChange: () => void;
}) {
  const [category, setCategory] = useState<ClaimDeduction['category']>('non_payable');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [borneBy, setBorneBy] = useState<'patient' | 'hospital'>('hospital');

  const add = async () => {
    if (!Number(amount)) return;
    try {
      await insuranceService.addDeduction({
        clinicId, claimId, category, amount: Number(amount), reason, borneBy, userId,
      });
      setAmount(''); setReason('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await insuranceService.deleteDeduction(id);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      <p className="text-xs font-medium text-slate-600 mb-1">Deductions / disallowances</p>
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <select value={category} onChange={(e) => setCategory(e.target.value as ClaimDeduction['category'])} className="border border-slate-300 rounded px-2 py-1 text-sm">
          {DEDUCTION_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <input type="number" placeholder="₹" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 border border-slate-300 rounded px-2 py-1 text-sm" />
        <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-40 border border-slate-300 rounded px-2 py-1 text-sm" />
        <select value={borneBy} onChange={(e) => setBorneBy(e.target.value as 'patient' | 'hospital')} className="border border-slate-300 rounded px-2 py-1 text-sm">
          <option value="hospital">Hospital write-off</option>
          <option value="patient">Patient bears</option>
        </select>
        <button onClick={add} disabled={!Number(amount)} className="flex items-center gap-1 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-sm px-2.5 py-1 rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      {deductions.length > 0 && (
        <div className="space-y-1">
          {deductions.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm border border-slate-100 rounded px-2 py-1">
              <span className="capitalize text-slate-600">{d.category.replace(/_/g, ' ')}</span>
              <span className="font-medium">{inr(d.amount)}</span>
              <span className="text-xs text-slate-400">{d.reason}</span>
              <span className={`text-xs ml-auto ${d.borne_by === 'patient' ? 'text-amber-700' : 'text-slate-500'}`}>{d.borne_by}</span>
              <button onClick={() => remove(d.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
