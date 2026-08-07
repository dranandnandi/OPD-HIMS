import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { LogOut, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { billingService, BillingOverviewRow } from '../services/billingService';

/**
 * Discharge worklist — every current inpatient with their financial clearance
 * status, so billing can settle balances before the patient is released. Rows
 * click through to the admission's billing tab (where the discharge action lives).
 */
export default function DischargesPage() {
  const { clinicId } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<BillingOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clinicId) return;
    billingService
      .getBillingOverview(clinicId)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clinicId]);

  // A patient is "financially clear" when nothing is unbilled and no bill balance.
  const pending = (r: BillingOverviewRow) => r.unbilledCharges + Math.max(r.billBalance, 0);
  const clearCount = rows.filter((r) => pending(r) <= 0).length;

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Discharge Worklist</h1>
      <p className="text-sm text-slate-500 mb-4">
        {loading ? 'Loading…' : `${rows.length} admitted · ${clearCount} financially clear`}
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          No active admissions.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Doctor</th>
                <th className="px-4 py-3">Admission</th>
                <th className="px-4 py-3">Bed</th>
                <th className="px-4 py-3 text-right">Unbilled ₹</th>
                <th className="px-4 py-3 text-right">Bill balance ₹</th>
                <th className="px-4 py-3">Clearance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const due = pending(r);
                const clear = due <= 0;
                return (
                  <tr
                    key={r.admissionId}
                    onClick={() => navigate(`/ipd/admissions/${r.admissionId}?tab=billing`)}
                    className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer"
                    title="Open billing / discharge for this patient"
                  >
                    <td className="px-4 py-3 font-medium text-blue-700 underline decoration-blue-200">{r.patientName}</td>
                    <td className="px-4 py-3 text-slate-600">{r.doctorName}</td>
                    <td className="px-4 py-3">
                      {r.admissionNumber}
                      <span className="block text-xs text-slate-400">
                        since {format(new Date(r.admissionDate), 'dd MMM')}
                      </span>
                    </td>
                    <td className="px-4 py-3">{r.bedLabel}</td>
                    <td className="px-4 py-3 text-right font-medium">₹{r.unbilledCharges.toLocaleString('en-IN')}</td>
                    <td className={`px-4 py-3 text-right font-medium ${r.billBalance > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      ₹{r.billBalance.toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3">
                      {clear ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Clear
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                          <AlertTriangle className="w-3.5 h-3.5" /> ₹{due.toLocaleString('en-IN')} due
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs bg-blue-600 text-white rounded-lg px-2.5 py-1.5">
                        <LogOut className="w-3.5 h-3.5" /> Billing / Discharge
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
