import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { insuranceService, ClaimWorklistRow, Claim } from '../services/insuranceService';

const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const STATUS_STYLE: Record<Claim['status'], string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  queried: 'bg-amber-100 text-amber-700',
  approved: 'bg-indigo-100 text-indigo-700',
  settled: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const FILTERS: Array<Claim['status'] | 'all' | 'open'> = ['open', 'all', 'submitted', 'queried', 'approved', 'settled', 'rejected'];

// Outstanding still to collect on a claim (approved if set, else claimed, minus received).
const outstandingOf = (r: ClaimWorklistRow) =>
  Math.max((r.approved_amount > 0 ? r.approved_amount : r.claimed_amount) - r.received_amount, 0);

const ageDaysOf = (r: ClaimWorklistRow) =>
  Math.floor((Date.now() - new Date(r.submitted_at ?? r.created_at).getTime()) / 86_400_000);

const bucketOf = (days: number) => (days <= 30 ? '0–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+');
const BUCKETS = ['0–30', '31–60', '61–90', '90+'] as const;

export default function TpaClaimsPage() {
  const { clinicId } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClaimWorklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'claims' | 'aging'>('claims');
  const [filter, setFilter] = useState<Claim['status'] | 'all' | 'open'>('open');

  useEffect(() => {
    if (!clinicId) return;
    insuranceService
      .getClaimsWorklist(clinicId)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clinicId]);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'open') return rows.filter((r) => r.status !== 'settled' && r.status !== 'rejected');
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const totals = filtered.reduce(
    (t, r) => ({
      claimed: t.claimed + Number(r.claimed_amount),
      received: t.received + Number(r.received_amount),
      deducted: t.deducted + Number(r.deducted_amount),
    }),
    { claimed: 0, received: 0, deducted: 0 }
  );

  // AR aging — open claims with something still to collect.
  const arRows = useMemo(
    () =>
      rows
        .filter((r) => r.status !== 'settled' && r.status !== 'rejected' && outstandingOf(r) > 0)
        .map((r) => ({ row: r, outstanding: outstandingOf(r), days: ageDaysOf(r) }))
        .sort((a, b) => b.days - a.days),
    [rows]
  );
  const bucketTotals = useMemo(() => {
    const m: Record<string, number> = { '0–30': 0, '31–60': 0, '61–90': 0, '90+': 0 };
    arRows.forEach((a) => { m[bucketOf(a.days)] += a.outstanding; });
    return m;
  }, [arRows]);
  const arTotal = arRows.reduce((s, a) => s + a.outstanding, 0);

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-1">
        <ShieldCheck className="w-5 h-5 text-navy-600" /> TPA / Insurance
      </h1>
      <p className="text-sm text-slate-500 mb-4">
        {loading ? 'Loading…' : view === 'claims' ? `${filtered.length} claim(s)` : `${inr(arTotal)} outstanding across ${arRows.length} claim(s)`}
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="flex gap-1 mb-4">
        {(['claims', 'aging'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-lg text-sm ${view === v ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
          >
            {v === 'claims' ? 'Claims' : 'AR Aging'}
          </button>
        ))}
      </div>

      {view === 'claims' ? (
        <>
          <div className="flex flex-wrap gap-1 mb-4">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
                  filter === f ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {!loading && filtered.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-4 max-w-2xl">
              <div className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-400">Claimed</p>
                <p className="text-lg font-bold text-slate-800">{inr(totals.claimed)}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-400">Received</p>
                <p className="text-lg font-bold text-emerald-700">{inr(totals.received)}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-400">Deducted</p>
                <p className="text-lg font-bold text-red-600">{inr(totals.deducted)}</p>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">No claims in this view.</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-4 py-3">Patient</th>
                    <th className="px-4 py-3">Admission</th>
                    <th className="px-4 py-3">Claim no.</th>
                    <th className="px-4 py-3 text-right">Claimed ₹</th>
                    <th className="px-4 py-3 text-right">Approved ₹</th>
                    <th className="px-4 py-3 text-right">Received ₹</th>
                    <th className="px-4 py-3 text-right">Deducted ₹</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => navigate(`/ipd/admissions/${r.admission_id}?tab=insurance`)}
                      className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-medium text-blue-700 underline decoration-blue-200">{r.patient_name}</td>
                      <td className="px-4 py-3">{r.admission_number}</td>
                      <td className="px-4 py-3">{r.claim_number || '—'}</td>
                      <td className="px-4 py-3 text-right">{inr(r.claimed_amount)}</td>
                      <td className="px-4 py-3 text-right">{inr(r.approved_amount)}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{inr(r.received_amount)}</td>
                      <td className="px-4 py-3 text-right text-red-600">{inr(r.deducted_amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 max-w-3xl">
            {BUCKETS.map((b) => (
              <div key={b} className={`bg-white rounded-xl border p-3 ${b === '90+' ? 'border-red-200' : 'border-slate-200'}`}>
                <p className="text-xs text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" /> {b} days</p>
                <p className={`text-lg font-bold ${b === '90+' ? 'text-red-600' : 'text-slate-800'}`}>{inr(bucketTotals[b])}</p>
              </div>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : arRows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">Nothing outstanding — all claims received or settled.</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-4 py-3">Patient</th>
                    <th className="px-4 py-3">Claim no.</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Outstanding ₹</th>
                    <th className="px-4 py-3 text-right">Age (days)</th>
                    <th className="px-4 py-3">Bucket</th>
                  </tr>
                </thead>
                <tbody>
                  {arRows.map(({ row: r, outstanding, days }) => (
                    <tr
                      key={r.id}
                      onClick={() => navigate(`/ipd/admissions/${r.admission_id}?tab=insurance`)}
                      className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-medium text-blue-700 underline decoration-blue-200">{r.patient_name}</td>
                      <td className="px-4 py-3">{r.claim_number || '—'}</td>
                      <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
                      <td className="px-4 py-3 text-right font-medium">{inr(outstanding)}</td>
                      <td className="px-4 py-3 text-right">{days}</td>
                      <td className={`px-4 py-3 ${days > 90 ? 'text-red-600 font-medium' : 'text-slate-600'}`}>{bucketOf(days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
