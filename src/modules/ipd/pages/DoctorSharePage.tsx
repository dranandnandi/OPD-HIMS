import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Percent, Calculator, IndianRupee, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { patientService } from '../services/patientService';
import { doctorShareService, DoctorContract, DoctorSettlement, Earnings } from '../services/doctorShareService';
import type { Profile } from '../types/ipd';

const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

export default function DoctorSharePage() {
  const { clinicId } = useAuth();
  const [tab, setTab] = useState<'contracts' | 'settlements'>('contracts');

  if (!clinicId) return null;

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-4">
        <Percent className="w-5 h-5 text-navy-600" /> Doctor Share & Settlement
      </h1>

      <div className="flex gap-1 mb-4">
        {(['contracts', 'settlements'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm capitalize ${
              tab === t ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {t === 'contracts' ? 'Share Rules' : 'Settlements'}
          </button>
        ))}
      </div>

      {tab === 'contracts' ? <ContractsTab clinicId={clinicId} /> : <SettlementsTab clinicId={clinicId} />}
    </div>
  );
}

// --- share rules -------------------------------------------------------------
function ContractsTab({ clinicId }: { clinicId: string }) {
  const { profile } = useAuth();
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [contracts, setContracts] = useState<Record<string, DoctorContract>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [docs, rows] = await Promise.all([
        patientService.listDoctors(clinicId),
        doctorShareService.listContracts(clinicId),
      ]);
      setDoctors(docs);
      const map: Record<string, DoctorContract> = {};
      rows.forEach((c) => { map[c.doctor_id] = c; });
      setContracts(map);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => { load(); }, [load]);

  const save = async (doctorId: string, sharePercent: number, shareBasis: 'gross' | 'net_received', isActive: boolean) => {
    try {
      await doctorShareService.upsertContract({ clinicId, doctorId, sharePercent, shareBasis, isActive, userId: profile?.id });
      toast.success('Share rule saved');
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="px-4 py-3">Doctor</th>
            <th className="px-4 py-3">Share %</th>
            <th className="px-4 py-3">Basis</th>
            <th className="px-4 py-3">Active</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {doctors.map((d) => (
            <ContractRow key={d.id} doctor={d} contract={contracts[d.id]} onSave={save} />
          ))}
          {doctors.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No doctors found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ContractRow({
  doctor, contract, onSave,
}: {
  doctor: Profile;
  contract?: DoctorContract;
  onSave: (doctorId: string, pct: number, basis: 'gross' | 'net_received', active: boolean) => void;
}) {
  const [pct, setPct] = useState(String(contract?.share_percent ?? ''));
  const [basis, setBasis] = useState<'gross' | 'net_received'>(contract?.share_basis ?? 'gross');
  const [active, setActive] = useState(contract?.is_active ?? true);

  return (
    <tr className="border-b border-slate-100">
      <td className="px-4 py-3 font-medium text-slate-800">Dr. {doctor.name?.replace(/^dr\.?\s*/i, '')}</td>
      <td className="px-4 py-3">
        <input type="number" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)}
          className="w-20 border border-slate-300 rounded px-2 py-1" placeholder="0" />
      </td>
      <td className="px-4 py-3">
        <select value={basis} onChange={(e) => setBasis(e.target.value as 'gross' | 'net_received')} className="border border-slate-300 rounded px-2 py-1">
          <option value="gross">Gross</option>
          <option value="net_received">Net received</option>
        </select>
      </td>
      <td className="px-4 py-3">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </td>
      <td className="px-4 py-3">
        <button onClick={() => onSave(doctor.id, Number(pct) || 0, basis, active)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg">Save</button>
      </td>
    </tr>
  );
}

// --- settlements -------------------------------------------------------------
function SettlementsTab({ clinicId }: { clinicId: string }) {
  const { profile } = useAuth();
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [computing, setComputing] = useState(false);
  const [history, setHistory] = useState<DoctorSettlement[]>([]);

  useEffect(() => {
    patientService.listDoctors(clinicId).then(setDoctors).catch(() => {});
    doctorShareService.listSettlements(clinicId).then(setHistory).catch(() => {});
  }, [clinicId]);

  const compute = async () => {
    if (!doctorId) { toast.error('Select a doctor'); return; }
    setComputing(true);
    try {
      setEarnings(await doctorShareService.computeEarnings(clinicId, doctorId, from, to));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setComputing(false);
    }
  };

  const generate = async () => {
    if (!doctorId || !earnings) return;
    try {
      await doctorShareService.createSettlement({
        clinicId, doctorId, from, to,
        gross: earnings.gross, sharePercent: earnings.sharePercent, shareAmount: earnings.shareAmount,
        userId: profile?.id,
      });
      toast.success('Settlement batch created');
      setEarnings(null);
      doctorShareService.listSettlements(clinicId).then(setHistory);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const markPaid = async (id: string) => {
    const ref = window.prompt('Payment reference (UTR / cheque no.)') ?? '';
    try {
      await doctorShareService.markPaid(id, ref);
      doctorShareService.listSettlements(clinicId).then(setHistory);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">Doctor
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="block border border-slate-300 rounded-lg px-2 py-1.5 text-sm min-w-48">
              <option value="">— select —</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.name?.replace(/^dr\.?\s*/i, '')}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <button onClick={compute} disabled={computing} className="flex items-center gap-1 bg-navy-700 hover:bg-navy-800 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg">
            <Calculator className="w-4 h-4" /> {computing ? 'Computing…' : 'Compute earnings'}
          </button>
        </div>

        {earnings && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-slate-400">Sharable charges</p><p className="font-bold">{earnings.count}</p></div>
              <div><p className="text-xs text-slate-400">Gross</p><p className="font-bold">{inr(earnings.gross)}</p></div>
              <div><p className="text-xs text-slate-400">Share %</p><p className="font-bold">{earnings.sharePercent}%</p></div>
              <div><p className="text-xs text-slate-400">Doctor payable</p><p className="font-bold text-emerald-700">{inr(earnings.shareAmount)}</p></div>
            </div>
            {earnings.sharePercent === 0 && (
              <p className="text-xs text-amber-600 mt-2">No share rule set for this doctor — set it under “Share Rules”.</p>
            )}
            {earnings.lines.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-slate-500 cursor-pointer">{earnings.lines.length} charge line(s)</summary>
                <div className="mt-2 max-h-56 overflow-auto text-xs">
                  {earnings.lines.map((l, i) => (
                    <div key={i} className="flex justify-between border-b border-slate-50 py-1">
                      <span>{new Date(l.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · {l.serviceName}</span>
                      <span>{inr(l.amount)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <button onClick={generate} disabled={earnings.shareAmount <= 0} className="mt-3 flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg">
              <IndianRupee className="w-4 h-4" /> Generate settlement
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-4 py-3">Doctor</th>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3 text-right">Gross ₹</th>
              <th className="px-4 py-3 text-right">Share ₹</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {history.map((s) => (
              <tr key={s.id} className="border-b border-slate-100">
                <td className="px-4 py-3">Dr. {s.doctor_name?.replace(/^dr\.?\s*/i, '')}</td>
                <td className="px-4 py-3 text-slate-600">
                  {new Date(s.period_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – {new Date(s.period_to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </td>
                <td className="px-4 py-3 text-right">{inr(s.gross_amount)}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-700">{inr(s.share_amount)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${s.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {s.status}{s.payment_ref ? ` · ${s.payment_ref}` : ''}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {s.status === 'draft' && (
                    <button onClick={() => markPaid(s.id)} className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Mark paid
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No settlements yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
